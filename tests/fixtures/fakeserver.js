// An in-page stand-in for a Topo server (server/, design §4), for the
// serversync, serverui and serverkeys suites. It answers js/server.js's
// fetch (TopoServer._hooks.fetch) with the same shapes and the same 409
// rules as the Go server (stale-base, stale-epoch, stale-roster), keeps
// only what the real one keeps (ciphertext, wraps, rosters, public keys),
// and computes the chain hash h the same way. It checks no signatures: the
// Go tests do that; the browser checks everything again itself, which is
// what the suites test.
//
// Loaded with a <script src> (the page's CSP allows only its own files).
//
//   const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
//   TopoServer._hooks.fetch = fake.fetch;
//   fake.code             the sign-in code every challenge takes ('123456')
//   fake.offline = true   every request fails as a network error
//   fake.loseNextPushAnswer = true   the next push is kept, but its answer is
//                         lost (a network error after the commit)
//   fake.calls            [{ method, path, body, status }]
//   fake.mails            [{ kind, to }]
//   fake.remote(email)    another browser: its own keys, pushes and grants
//                         through the fake's state (see Remote below)
//   Backups (step 5b): fake.backup is the server owner's settings and
//   status; fake.backupFile(siteId) builds a topo-backup file of the head
//   as server/internal/backup/snapshot.go does, fake.addBackup(siteId)
//   lists one; fake.backupFails = 'refused' makes Test and Save fail.
//   5c: oauth/start answers https://provider.example.test/auth?state=…;
//   fake.oauthBack(url) is the provider's answer (the fragment the app
//   gets back); finish checks the state once and connects as
//   fake.oauthAccount.
(function () {
'use strict';
const C = () => window.TopoServerCrypto;

window.FakeTopoServer = function (opts = {}) {
    const S = {
        users: new Map(), byEmail: new Map(), devices: new Map(), sites: new Map(), sessions: new Map(),
        session: null, challenges: new Map(), linkRequests: new Map(), seq: 0
    };
    const fake = { code: '123456', offline: false, calls: [], mails: [], state: S, ownerEmail: opts.ownerEmail || 'owner@example.test', health: { setup: false, maxRevBytes: 8 << 20 } };
    fake.backup = { config: { enabled: false, kind: '', fields: {}, secrets: {}, dailyAt: '02:30', readableAllowed: false, updated: 0 },
        status: { lastOk: 0, lastError: null, lastCheck: null, nextRun: null, backoffUntil: 0 }, files: [], readables: [], runs: 0, checks: 0, allowed: ['/srv/topo/backups'] };
    fake.backupFails = null;
    fake.oauthAccount = 'ana@example.test';
    // The provider said yes: the fragment the app is sent back with.
    fake.oauthBack = (url, error) => {
        const st = new URL(url).searchParams.get('state');
        const inner = new URLSearchParams(error ? { state: st, error } : { state: st, code: 'c' + Math.random().toString(36).slice(2, 10) }).toString();
        return 'backup-connect=' + encodeURIComponent(inner);
    };
    const id = (p) => p + C().b64u(C().random(16));
    const now = () => Date.now();
    function user(email) {
        const e = String(email).toLowerCase();
        if (S.byEmail.has(e)) return S.users.get(S.byEmail.get(e));
        const u = { id: id('u_'), email: e, lang: 'en', serverRole: e === fake.ownerEmail ? 'owner' : 'member', encPub: '', sigPub: '', keysAt: 0, escrow: null,
            notify: { revision: true, revisionShared: false, visit: true, incident: true, closed: true, join: true } };
        S.users.set(u.id, u); S.byEmail.set(e, u.id);
        return u;
    }
    fake.user = user;
    const meOf = (u) => {
        const sess = S.sessions.get(S.session);
        const dev = sess && sess.device ? S.devices.get(sess.device) : null;
        let waiting = 0;
        S.sites.forEach((s) => { const m = s.members.get(u.id); if (m && m.role === 'owner' && m.status === 'granted') s.members.forEach((x) => { if (x.status === 'waiting' && S.users.get(x.user).encPub) waiting++; }); });
        return { id: u.id, email: u.email, lang: u.lang, serverRole: u.serverRole, canCreate: u.serverRole !== 'member', keys: u.encPub ? { encPub: u.encPub, sigPub: u.sigPub, at: u.keysAt } : null,
            hasEscrow: !!u.escrow, notify: u.notify, device: dev ? { id: dev.id, linked: !!dev.wrap } : null, waitingGrants: waiting, linkRequests: 0 };
    };
    const siteJSON = (s, u) => {
        const m = s.members.get(u.id);
        let granted = 0, waiting = 0;
        s.members.forEach((x) => { if (x.status === 'granted') granted++; else waiting++; });
        const out = { id: s.id, role: m.role, status: m.status, epoch: s.epoch, head: { n: s.revs.length, h: s.headH }, rosterSeq: s.rosters.length, nameCt: s.nameCt || null,
            nameClear: s.showName ? s.nameClear : null, showName: !!s.showName, updated: s.updated, bytes: 0, members: granted, muted: !!m.muted };
        if (m.role === 'owner' && m.status === 'granted') out.waiting = waiting;
        return out;
    };
    const err = (status, code, data) => ({ status, body: Object.assign({ error: code }, data || {}) });
    const ok = (body, status = 200) => ({ status, body });
    async function headerH(site, r) { return C().chainHash(C().revSigned(Object.assign({ site }, r)), r.sig); }

    // ---- The routes ----
    async function route(method, path, body) {
        const url = new URL(path, location.origin);
        const p = url.pathname;
        const q = url.searchParams;
        const sess = S.sessions.get(S.session);
        const me = sess ? S.users.get(sess.user) : null;
        let m;
        if (p === '/api/health') return ok({ ok: true, server: 'topo', api: 1, version: 'fake', appHash: 'x', app: true, secure: true, setup: fake.health.setup, maxRevBytes: fake.health.maxRevBytes, signedIn: !!me });
        if (method === 'POST' && p === '/api/auth/request') {
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email || '')) return err(400, 'bad-email');
            const c = id('c_'); S.challenges.set(c, String(body.email).toLowerCase());
            fake.mails.push({ kind: 'signin', to: String(body.email).toLowerCase(), code: fake.code });
            return ok({ challenge: c }, 202);
        }
        if (method === 'POST' && p === '/api/auth/verify') {
            const email = S.challenges.get(body.challenge);
            if (!email || body.code !== fake.code) return err(400, 'bad-code');
            S.challenges.delete(body.challenge);
            const u = user(email);
            const sid = id('l_');
            const dev = body.deviceId && S.devices.get(body.deviceId) && S.devices.get(body.deviceId).user === u.id ? body.deviceId : null;
            S.sessions.set(sid, { user: u.id, device: dev });
            S.session = sid;
            return ok({ user: meOf(u) });
        }
        if (!me) return err(401, 'unauthorized');
        if (method === 'POST' && p === '/api/auth/signout') { S.sessions.delete(S.session); S.session = null; return { status: 204 }; }
        if (p === '/api/me' && method === 'GET') return ok(meOf(me));
        if (p === '/api/me' && method === 'PATCH') { if (body.lang) me.lang = body.lang; if (body.notify) Object.assign(me.notify, body.notify); return ok(meOf(me)); }
        if (p === '/api/me/sessions') return ok({ sessions: [{ id: S.session, current: true, created: 1, lastSeen: 1, ip: '', ua: '' }] });
        if (method === 'POST' && p === '/api/devices') {
            const d = { id: id('d_'), user: me.id, devPub: body.devPub, label: body.label || '', wrap: null };
            S.devices.set(d.id, d); sess.device = d.id;
            return ok({ id: d.id }, 201);
        }
        if (p === '/api/devices' && method === 'GET') return ok({ devices: [...S.devices.values()].filter((d) => d.user === me.id).map((d) => ({ id: d.id, label: d.label, linked: !!d.wrap, current: d.id === sess.device })) });
        if ((m = /^\/api\/devices\/([^/]+)\/wrap$/.exec(p))) {
            const d = S.devices.get(m[1]);
            if (!d || d.user !== me.id || !d.wrap) return err(404, 'not-found');
            return ok({ wrap: d.wrap, wrappedBy: 'setup' });
        }
        if (method === 'PUT' && p === '/api/me/keys') {
            if (me.encPub && !body.reset) return err(409, 'conflict');
            if (!sess.device) return err(409, 'no-device');
            const wasKeyed = !!me.encPub;
            me.encPub = body.encPub; me.sigPub = body.sigPub; me.keysAt = now(); me.escrow = body.escrow || null;
            S.devices.forEach((d) => { if (d.user === me.id) d.wrap = null; });
            S.devices.get(sess.device).wrap = body.deviceWrap;
            if (wasKeyed) S.sites.forEach((s) => { const mm = s.members.get(me.id); if (mm) { mm.status = 'waiting'; Object.keys(s.wraps).forEach((k) => { if (k.endsWith('|' + me.id)) delete s.wraps[k]; }); } });
            return ok(meOf(me));
        }
        if (p === '/api/me/escrow' && method === 'GET') return me.escrow ? ok({ escrow: me.escrow }) : err(404, 'not-found');
        if (p === '/api/me/escrow' && method === 'PUT') { me.escrow = body.escrow; return { status: 204 }; }
        if (p === '/api/me/devices/self-wrap') { S.devices.get(sess.device).wrap = body.wrap; return { status: 204 }; }
        if (p === '/api/link-requests' && method === 'GET') return ok({ requests: [] });
        if (p === '/api/sites' && method === 'GET') {
            const sites = [], invites = [];
            S.sites.forEach((s) => {
                if (s.members.has(me.id)) sites.push(siteJSON(s, me));
                else s.invites.filter((i) => i.status === 'pending' && i.email === me.email).forEach((i) => invites.push({ id: i.id, site: s.id, role: i.role, nameClear: null, inviter: i.inviter, expires: i.expires }));
            });
            return ok({ sites, invites });
        }
        if (p === '/api/sites' && method === 'POST') {
            if (me.serverRole === 'member') return err(403, 'forbidden');
            if (S.sites.has(body.id)) return err(409, 'conflict');
            const s = { id: body.id, epoch: 1, headH: await C().genesis(body.id), revs: [], rosters: [body.roster], wraps: { ['1|' + me.id]: body.wrap }, nameCt: body.nameCt || null,
                showName: !!body.showName, nameClear: body.nameClear || null, members: new Map([[me.id, { user: me.id, role: 'owner', status: 'granted', added: now() }]]), invites: [], updated: now() };
            S.sites.set(s.id, s);
            return ok({ site: siteJSON(s, me) }, 201);
        }
        if (method === 'POST' && p === '/api/invites/accept') {
            for (const s of S.sites.values()) {
                const i = s.invites.find((x) => x.status === 'pending' && (x.token === body.token || x.id === body.id));
                if (!i) continue;
                if (i.email !== me.email) return err(403, 'wrong-email');
                i.status = 'accepted';
                s.members.set(me.id, { user: me.id, role: i.role, status: 'waiting', added: now() });
                return ok({ site: siteJSON(s, me) });
            }
            return err(400, 'bad-invite');
        }
        if (method === 'POST' && p === '/api/invites/peek') {
            for (const s of S.sites.values()) { const i = s.invites.find((x) => x.token === body.token && x.status === 'pending'); if (i) return ok({ email: i.email, role: i.role, site: s.id, nameClear: null, inviter: i.inviter }); }
            return err(400, 'bad-invite');
        }
        if (p === '/api/admin/users' && method === 'GET') {
            if (me.serverRole !== 'owner') return err(403, 'forbidden');
            return ok({ users: [...S.users.values()].map((u) => ({ id: u.id, email: u.email, serverRole: u.serverRole, disabled: false })) });
        }
        // ---- Backups: the server owner's (step 5b) ----
        if (p.startsWith('/api/admin/backups')) {
            if (me.serverRole !== 'owner') return err(403, 'forbidden');
            const B = fake.backup, c = B.config;
            const view = () => {
                const sites = [];
                S.sites.forEach((x) => { const f = B.files.filter((y) => y.site === x.id && y.kind === 'enc'); if (f.length) sites.push({ site: x.id, name: x.showName ? x.nameClear : '', count: f.length, last: Math.max(...f.map((y) => y.at)), missing: f.filter((y) => y.missing).length }); });
                return { config: { enabled: c.enabled, kind: c.kind, fields: Object.assign({}, c.fields), secretsSet: Object.keys(c.secrets).filter((k) => k !== 'refreshToken').sort(), dailyAt: c.dailyAt, readableAllowed: c.readableAllowed, updated: c.updated,
                    connected: !!c.secrets.refreshToken || undefined, account: c.secrets.refreshToken ? c.account : undefined },
                    kinds: ['folder', 'gdrive', 'onedrive', 's3', 'webdav'], allowedFolders: B.allowed.slice(), status: Object.assign({}, B.status, { nextRun: c.enabled ? now() + 3600e3 : null }), sites, deleted: [], previousDest: 0,
                    oauthRedirect: 'https://topo.example.test/api/backups/oauth/callback' };
            };
            const merged = () => {
                const next = { enabled: body.enabled !== undefined ? !!body.enabled : c.enabled, kind: body.kind !== undefined ? body.kind : c.kind, dailyAt: body.dailyAt || c.dailyAt,
                    readableAllowed: body.readableAllowed !== undefined ? !!body.readableAllowed : c.readableAllowed };
                next.fields = body.fields || (next.kind === c.kind ? c.fields : {});
                const host = (f) => [f.url, f.endpoint, f.keyId, f.clientId, f.tenant].map((x) => x || '').join('|');
                next.secrets = next.kind === c.kind && host(next.fields) === host(c.fields) ? Object.assign({}, c.secrets) : {};
                Object.entries(body.secrets || {}).forEach(([k, v]) => { if (v === '') delete next.secrets[k]; else if (v) next.secrets[k] = v; });
                if (next.kind === 'folder' && !B.allowed.some((r) => String(next.fields.path || '').startsWith(r))) return { bad: err(422, 'backup-folder-not-allowed', { field: 'path', allowed: B.allowed }) };
                if (next.kind === 'webdav' && !/^https?:\/\//.test(next.fields.url || '')) return { bad: err(400, 'bad-request', { field: 'url', code: 'bad' }) };
                return { next };
            };
            if (method === 'GET' && p === '/api/admin/backups') return ok(view());
            if (method === 'PUT' && p.startsWith('/api/admin/backups')) {
                const r = merged(); if (r.bad) return r.bad;
                if (r.next.enabled && fake.backupFails && !q.get('force')) return err(422, 'backup-dest', { code: fake.backupFails });
                Object.assign(c, r.next, { updated: now() });
                fake.backup.saves = (fake.backup.saves || 0) + 1;
                return ok(view());
            }
            if (method === 'POST' && p === '/api/admin/backups/test') {
                const r = merged(); if (r.bad) return r.bad;
                if (!r.next.kind) return err(409, 'backup-off');
                if (fake.backupFails) return err(422, 'backup-dest', { code: fake.backupFails });
                return ok({ ok: true });
            }
            if (method === 'POST' && p === '/api/admin/backups/oauth/start') {
                const r = merged(); if (r.bad) return r.bad;
                if (r.next.kind !== 'gdrive' && r.next.kind !== 'onedrive') return err(400, 'oauth-kind');
                if (!r.next.secrets.clientSecret) return err(400, 'bad-request', { field: 'clientSecret', code: 'missing' });
                const state = id('st_');
                B.oauth = B.oauth || new Map();
                B.oauth.set(state, { next: r.next, session: S.session });
                B.starts = (B.starts || 0) + 1;
                return ok({ url: 'https://provider.example.test/auth?state=' + state, redirect: 'http://localhost/api/backups/oauth/callback' });
            }
            if (method === 'POST' && p === '/api/admin/backups/oauth/finish') {
                const o = B.oauth && B.oauth.get(body.state);
                if (B.oauth) B.oauth.delete(body.state);
                if (!o || o.session !== S.session) return err(400, 'oauth-state');
                if (body.error || !body.code) return err(422, 'oauth-denied');
                o.next.secrets = Object.assign({}, o.next.secrets, { refreshToken: 'rt-' + body.code });
                Object.assign(c, o.next, { account: fake.oauthAccount, updated: now() });
                B.finishes = (B.finishes || 0) + 1;
                return ok(Object.assign(view(), { connect: { account: fake.oauthAccount } }));
            }
            if (method === 'POST' && (p === '/api/admin/backups/run' || p === '/api/admin/backups/check')) {
                if (!c.enabled) return err(409, 'backup-off');
                if (p.endsWith('/run')) { B.runs++; B.status.lastOk = now(); } else { B.checks++; B.status.lastCheck = { at: now(), ok: true }; }
                return ok({ ok: true }, 202);
            }
            return err(404, 'not-found');
        }
        if (!(m = /^\/api\/sites\/([^/]+)(\/.*)?$/.exec(p))) return err(404, 'not-found');
        const s = S.sites.get(m[1]);
        const rest = m[2] || '';
        const mem = s && s.members.get(me.id);
        if (!s || !mem) return err(404, 'not-found');
        const granted = mem.status === 'granted';
        const owner = granted && mem.role === 'owner';
        if (rest === '' && method === 'GET') {
            const members = [...s.members.values()].filter((x) => granted || x.user === me.id).map((x) => { const u = S.users.get(x.user); return { user: u.id, email: u.email, role: x.role, status: x.status, encPub: u.encPub, sigPub: u.sigPub, keysAt: u.keysAt, added: x.added }; });
            const out = { site: siteJSON(s, me), members };
            if (owner) out.invites = s.invites.filter((i) => i.status === 'pending').map((i) => ({ id: i.id, email: i.email, role: i.role, status: i.status, created: i.created, expires: i.expires }));
            if (owner) out.backups = { on: fake.backup.config.enabled && !!fake.backup.config.kind, readableAllowed: fake.backup.config.readableAllowed, readable: !!s.backupReadable };
            return ok(out);
        }
        if (rest === '' && method === 'DELETE') { if (!owner) return err(403, 'forbidden'); S.sites.delete(s.id); return { status: 204 }; }
        if (rest === '' && method === 'PATCH') {
            if (!owner) return err(403, 'forbidden');
            if (body.showName !== undefined) { s.showName = !!body.showName; s.nameClear = body.showName ? body.nameClear || null : null; }
            if (body.nameSlug !== undefined) { if (body.nameSlug && !/^[\p{L}\p{M}\p{N}]+(-[\p{L}\p{M}\p{N}]+)*$/u.test(body.nameSlug)) return err(400, 'bad-request', { field: 'nameSlug' }); s.nameSlug = s.showName ? body.nameSlug : ''; }
            if (!s.showName) s.nameSlug = '';
            if (body.backupReadable !== undefined) { if (body.backupReadable && !fake.backup.config.readableAllowed) return err(409, 'readable-off'); s.backupReadable = !!body.backupReadable; }
            return ok({ site: siteJSON(s, me) });
        }
        if (rest === '/me' && method === 'PATCH') { mem.muted = !!body.muted; return ok({ site: siteJSON(s, me) }); }
        if (!granted && rest !== '/leave') return err(403, 'forbidden');
        if (rest === '/rosters') {
            const since = Number(q.get('since') || 0);
            const rosters = s.rosters.filter((r) => r.seq > since);
            const pubs = {};
            rosters.forEach((r) => [r.by, ...r.members.map((x) => x.u)].forEach((u) => { const uu = S.users.get(u); if (uu && uu.encPub) pubs[u] = { encPub: uu.encPub, sigPub: uu.sigPub }; }));
            return ok({ rosters, pubs });
        }
        if (rest === '/keys') return ok({ wraps: Object.entries(s.wraps).filter(([k]) => k.endsWith('|' + me.id)).map(([k, w]) => ({ epoch: Number(k.split('|')[0]), wrap: w })) });
        const nextRoster = (r, epoch) => {
            if (!r || r.seq !== s.rosters.length + 1) return err(409, 'stale-roster', { rosterSeq: s.rosters.length });
            if (r.epoch !== epoch || r.by !== me.id) return err(422, 'bad-roster');
            return null;
        };
        if (rest === '/grant') {
            if (!owner) return err(403, 'forbidden');
            const bad = nextRoster(body.roster, s.epoch); if (bad) return bad;
            for (const w of body.wraps) { const x = s.members.get(w.user); if (!x || x.status !== 'waiting') return err(409, 'conflict'); }
            body.wraps.forEach((w) => { s.wraps[w.epoch + '|' + w.user] = w.wrap; s.members.get(w.user).status = 'granted'; });
            s.rosters.push(body.roster);
            body.wraps.forEach((w) => fake.mails.push({ kind: 'granted', to: S.users.get(w.user).email }));
            return ok({ site: siteJSON(s, me) });
        }
        if ((m = /^\/members\/([^/]+)\/role$/.exec(rest))) {
            if (!owner) return err(403, 'forbidden');
            const x = s.members.get(m[1]);
            if (!x) return err(404, 'not-found');
            if (x.status === 'granted') { const bad = nextRoster(body.roster, s.epoch); if (bad) return bad; s.rosters.push(body.roster); }
            x.role = body.role;
            return ok({ site: siteJSON(s, me) });
        }
        if (rest === '/remove' || rest === '/rotate') {
            if (!owner) return err(403, 'forbidden');
            const x = rest === '/remove' ? s.members.get(body.user) : null;
            if (rest === '/remove' && !x) return err(404, 'not-found');
            // As the Go server: a member the roster in force names may hold
            // the current key even while waiting (a key reset): rotate too.
            const named = !!x && s.rosters[s.rosters.length - 1].members.some((mm) => mm.u === body.user);
            if (rest === '/rotate' || x.status === 'granted' || named) {
                const bad = nextRoster(body.roster, s.epoch + 1); if (bad) return bad;
                s.epoch++; s.rosters.push(body.roster); s.nameCt = body.nameCt || s.nameCt;
                body.wraps.forEach((w) => { s.wraps[w.epoch + '|' + w.user] = w.wrap; });
            }
            if (x) { s.members.delete(body.user); Object.keys(s.wraps).forEach((k) => { if (k.endsWith('|' + body.user)) delete s.wraps[k]; }); }
            return ok({ site: siteJSON(s, me) });
        }
        if (rest === '/leave') { s.members.delete(me.id); return { status: 204 }; }
        // ---- Backups: a network's owners (step 5b) ----
        if (rest.startsWith('/backups')) {
            if (!owner) return err(403, 'forbidden');
            const files = fake.backup.files.filter((f) => f.site === s.id);
            if (rest === '/backups' && method === 'GET') return ok({ backups: files.slice().sort((a, b) => b.at - a.at).map((f) => ({ id: f.id, name: f.name, kind: f.kind, at: f.at, revN: f.revN, size: f.body.length, missing: !!f.missing, previousDest: false })) });
            if (rest === '/backups/readable' && method === 'POST') {
                if (!fake.backup.config.enabled || !fake.backup.config.readableAllowed || !s.backupReadable) return err(409, 'readable-off');
                if (body.revN !== s.revs.length) return err(409, 'stale', { head: s.revs.length });
                if (!/^topo_[^/\\]+\.json$/.test(body.fileName || '')) return err(400, 'bad-request', { field: 'file' });
                fake.backup.readables.push({ site: s.id, revN: body.revN, fileName: body.fileName, file: body.file });
                fake.backup.files.push({ id: id('b_'), site: s.id, name: body.fileName, kind: 'readable', at: now(), revN: body.revN, body: JSON.stringify(body.file) });
                return ok({ ok: true }, 202);
            }
            if (rest === '/backups/readable' && method === 'DELETE') { fake.backup.files = fake.backup.files.filter((f) => !(f.site === s.id && f.kind === 'readable')); return { status: 204 }; }
            if ((m = /^\/backups\/([^/]+)$/.exec(rest)) && method === 'GET') {
                const f = files.find((x) => x.id === m[1]);
                if (!f) return err(404, 'not-found');
                if (f.missing) return err(404, 'not-found', { missing: true });
                return { status: 200, raw: f.body };
            }
            return err(404, 'not-found');
        }
        if (rest === '/invites' && method === 'POST') {
            if (!owner) return err(403, 'forbidden');
            const i = { id: id('i_'), email: String(body.email).toLowerCase(), role: body.role, status: 'pending', token: id('t_'), inviter: me.email, created: now(), expires: now() + 14 * 864e5 };
            s.invites.push(i);
            fake.mails.push({ kind: 'invite', to: i.email, token: i.token });
            return ok({ invite: { id: i.id, email: i.email, role: i.role, status: 'pending', created: i.created, expires: i.expires } }, 201);
        }
        if (rest === '/revs' && method === 'POST') {
            if (mem.role === 'viewer') return err(403, 'forbidden');
            const r = body.rev;
            if (r.base !== s.revs.length) return err(409, 'stale-base', { head: { n: s.revs.length, h: s.headH } });
            if (r.epoch !== s.epoch) return err(409, 'stale-epoch', { epoch: s.epoch });
            if (r.rseq !== s.rosters.length) return err(409, 'stale-roster', { rosterSeq: s.rosters.length });
            if (r.n !== r.base + 1 || r.prev !== s.headH || r.author !== me.id) return err(422, 'bad-chain');
            const h = await headerH(s.id, r);
            const ct = C().unb64u(r.ct);
            s.revs.push({ hdr: { n: r.n, base: r.base, prev: r.prev, epoch: r.epoch, rseq: r.rseq, author: r.author, dev: r.dev, at: r.at, size: ct.length, ctHash: r.ctHash, sig: r.sig, h, received: now(), pruned: false },
                body: { iv: r.iv, ct: r.ct }, events: body.events || [] });
            s.headH = h; s.updated = now();
            fake.pushes = (fake.pushes || 0) + 1;
            return ok({ n: r.n, h }, 201);
        }
        if (rest === '/revs' && method === 'GET') {
            const since = Number(q.get('since') || 0);
            const revs = s.revs.filter((r) => r.hdr.n > since).map((r) => Object.assign({}, r.hdr));
            const head = s.revs[s.revs.length - 1];
            return ok({ head: { n: s.revs.length, h: s.headH, epoch: s.epoch, rosterSeq: s.rosters.length }, revs, more: false,
                body: head && s.revs.length > since ? { n: head.hdr.n, iv: head.body.iv, ct: head.body.ct } : null });
        }
        if ((m = /^\/revs\/(\d+)$/.exec(rest))) {
            const r = s.revs[Number(m[1]) - 1];
            if (!r) return err(404, 'not-found');
            if (r.hdr.pruned) return err(410, 'gone', { rev: r.hdr });
            return ok({ rev: r.hdr, body: r.body });
        }
        return err(404, 'not-found');
    }

    fake.fetch = async (path, init = {}) => {
        const method = init.method || 'GET';
        const body = init.body ? JSON.parse(init.body) : undefined;
        if (fake.offline) { fake.calls.push({ method, path, body, status: 0 }); throw new TypeError('Failed to fetch'); }
        if (method !== 'GET' && (!init.headers || init.headers['X-Topo'] !== '1')) return response({ status: 403, body: { error: 'csrf' } });
        const res = await route(method, path, body);
        fake.calls.push({ method, path, body, status: res.status });
        if (fake.loseNextPushAnswer && method === 'POST' && /\/revs$/.test(path) && res.status === 201) { fake.loseNextPushAnswer = false; throw new TypeError('Failed to fetch'); }
        return response(res);
    };
    const response = (res) => ({ ok: res.status >= 200 && res.status < 300, status: res.status,
        json: async () => (res.raw !== undefined ? JSON.parse(res.raw) : res.body === undefined ? null : JSON.parse(JSON.stringify(res.body))),
        text: async () => (res.raw !== undefined ? res.raw : res.body === undefined ? '' : JSON.stringify(res.body)) });

    // ---- Another browser: its own person and keys, acting through the state ----
    fake.remote = async (email) => {
        const u = user(email);
        const R = { user: u, keys: new Map() };
        const k = await C().newUser();
        Object.assign(R, { enc: k.enc, sig: k.sig, encPub: k.encPub, sigPub: k.sigPub });
        u.encPub = k.encPub; u.sigPub = k.sigPub; u.keysAt = now();
        // Accepts an invitation (or is added as a waiting member) to a site.
        R.join = (siteId, role) => { const s = S.sites.get(siteId); s.members.set(u.id, { user: u.id, role, status: 'waiting', added: now() }); };
        // The site keys it was given (unwrapped like a browser would).
        R.unwrapKeys = async (siteId) => {
            const s = S.sites.get(siteId);
            for (const [kk, w] of Object.entries(s.wraps)) {
                if (!kk.endsWith('|' + u.id)) continue;
                const epoch = Number(kk.split('|')[0]);
                const signer = S.users.get(w.by);
                const raw = await C().unwrap(w, { priv: R.enc, pub: R.encPub, ctx: C().siteCtx(siteId, epoch, u.id), signers: [signer.sigPub] });
                R.keys.set(siteId + '|' + epoch, await C().importSiteKey(raw));
            }
        };
        // The head's document, decrypted.
        R.head = async (siteId) => {
            const s = S.sites.get(siteId);
            const r = s.revs[s.revs.length - 1];
            const key = R.keys.get(siteId + '|' + r.hdr.epoch);
            return C().unpackDoc(await C().openRevision(Object.assign({ site: siteId }, r.hdr), r.body, key));
        };
        // Pushes a new revision: mutate(doc) changes the head's copy. opts: { epoch, rseq, events }
        R.push = async (siteId, mutate, o = {}) => {
            const s = S.sites.get(siteId);
            const env = s.revs.length ? await R.head(siteId) : { v: 1, id: o.id, name: 'X', doc: { nodes: [], links: [] } };
            const doc = JSON.parse(JSON.stringify(env.doc));
            const next = mutate(doc) || doc;
            const epoch = o.epoch || s.epoch;
            const plain = await C().packDoc({ v: 1, id: o.envId || env.id, name: env.name, rev: 'r' + C().b64u(C().random(9)), base: env.rev || null, prior: [], doc: next });
            const sealed = await C().sealRevision({ site: siteId, n: s.revs.length + 1, base: s.revs.length, prev: s.headH, epoch, rseq: o.rseq || s.rosters.length, author: u.id, dev: 'd_remote', at: now() },
                R.keys.get(siteId + '|' + epoch), R.sig, plain);
            const r = sealed.envelope;
            s.revs.push({ hdr: { n: r.n, base: r.base, prev: r.prev, epoch: r.epoch, rseq: r.rseq, author: r.author, dev: r.dev, at: r.at, size: 1, ctHash: r.ctHash, sig: r.sig, h: sealed.h, received: now(), pruned: false },
                body: { iv: r.iv, ct: r.ct }, events: o.events || [] });
            s.headH = sealed.h;
            return sealed.h;
        };
        return R;
    };
    // ---- A backup file of a site's head (server/internal/backup/snapshot.go) ----
    // o: { originHash, name (shown in clear), dropPubs: [user ids] (keys reset
    // since), at }.
    fake.backupFile = async (siteId, o = {}) => {
        const s = S.sites.get(siteId);
        const r = s.revs[s.revs.length - 1];
        const hd = r.hdr;
        const rosters = [s.rosters[hd.rseq - 1]];
        const newest = s.rosters[s.rosters.length - 1];
        if (newest !== rosters[0]) rosters.push(newest);
        const pubs = {};
        for (const ro of rosters) for (const mm of ro.members) {
            const u = S.users.get(mm.u);
            if (!u || !u.encPub || (o.dropPubs || []).includes(u.id)) continue;
            if ((await C().fp(u.encPub)) === mm.enc && (await C().fp(u.sigPub)) === mm.sig) pubs[u.id] = { encPub: u.encPub, sigPub: u.sigPub };
        }
        const owners = [];
        s.members.forEach((mm) => {
            if (mm.role !== 'owner' || mm.status !== 'granted') return;
            const w = s.wraps[hd.epoch + '|' + mm.user];
            if (!w) return;
            owners.push({ u: mm.user, wrap: w, escrow: S.users.get(mm.user).escrow || null });
        });
        return {
            $schema: 'https://topo.carino.systems/schema/topo-backup-v1.json', kind: 'topo-backup', v: 1, site: siteId, made: new Date(o.at || now()).toISOString(),
            originHash: o.originHash || C().b64u(await C().sha256(C().utf8(location.origin))), name: o.name || null, nameCt: s.nameCt || null,
            rev: { n: hd.n, base: hd.base, prev: hd.prev, epoch: hd.epoch, rseq: hd.rseq, author: hd.author, dev: hd.dev, at: hd.at, ctHash: hd.ctHash, sig: hd.sig, h: hd.h, iv: r.body.iv, ct: r.body.ct },
            rosters, pubs, owners
        };
    };
    // Lists a backup of the head (as the engine would after a push).
    fake.addBackup = async (siteId, o = {}) => {
        const file = await fake.backupFile(siteId, o);
        const at = o.at || now();
        const day = new Date(at).toISOString().slice(0, 10);
        const taken = fake.backup.files.filter((f) => f.site === siteId && f.name.startsWith('topo_network-x_' + day)).length;
        const f = { id: id('b_'), site: siteId, name: 'topo_network-x_' + day + (taken ? '_' + String(taken).padStart(4, '0') : '') + '.json', kind: 'enc', at, revN: file.rev.n, body: JSON.stringify(file) };
        fake.backup.files.push(f);
        return f;
    };
    // Tests: roll the history back, or tamper with a body.
    fake.rollback = (siteId, n) => { const s = S.sites.get(siteId); s.revs = s.revs.slice(0, n); s.headH = s.revs.length ? s.revs[s.revs.length - 1].hdr.h : s.headH0 || s.headH; };
    fake.site = (siteId) => S.sites.get(siteId);
    return fake;
};
})();
