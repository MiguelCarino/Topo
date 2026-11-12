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
//   Monitors (step 7h): /monitors, /records, /stats, /stats-days as
//   server/internal/api/monitors.go answers them (the signature checks are
//   the Go tests'); fake.remoteMonitor(siteId, name) is a PC turned into a
//   monitor (src-tauri/src/monitorlink.rs in WebCrypto): its keys, its
//   token, and the records it seals, signs and pushes.
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
        if (method === 'DELETE' && (m = p.match(/^\/api\/me\/sessions\/([^/]+)$/))) {
            const x = S.sessions.get(decodeURIComponent(m[1]));
            if (!x || x.user !== me.id) return err(404, 'not-found');
            S.sessions.delete(decodeURIComponent(m[1]));
            if (decodeURIComponent(m[1]) === S.session) S.session = null;
            return { status: 204 };
        }
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
            if (body.role !== 'provider') s.visits = (s.visits || []).filter((v) => v.author !== m[1]);   // D191
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
            if (x && s.monitors) s.monitors = s.monitors.filter((mm) => mm.id !== body.user);   // a monitor removed is revoked (D149)
            if (x) { s.visits = (s.visits || []).filter((v) => v.author !== body.user); s.members.delete(body.user); Object.keys(s.wraps).forEach((k) => { if (k.endsWith('|' + body.user)) delete s.wraps[k]; }); }
            return ok({ site: siteJSON(s, me) });
        }
        // ---- Monitors (server/internal/api/monitors.go, step 7h) ----
        s.monitors = s.monitors || [];
        s.records = s.records || [];
        s.stats = s.stats || [];
        if (s.statsDays === undefined) s.statsDays = 360;
        if (rest === '/monitors' && method === 'POST') {
            if (!owner) return err(403, 'forbidden');
            const mid = 'm_' + [...C().random(11)].map((b) => b.toString(16).padStart(2, '0')).join('');
            const u = { id: mid, email: mid, lang: 'en', serverRole: 'member', encPub: body.encPub, sigPub: body.sigPub, keysAt: now(), escrow: null, notify: {} };
            S.users.set(mid, u);
            s.members.set(mid, { user: mid, role: 'monitor', status: 'waiting', added: now() });
            const token = id('t_');
            const mon = { id: mid, name: body.name, by: me.id, byEmail: me.email, created: now(), intervalMs: 60000, lastReport: 0, stale: false, encPub: body.encPub, sigPub: body.sigPub, token };
            s.monitors.push(mon);
            return ok({ monitor: Object.assign({}, mon, { token: undefined }), token }, 201);
        }
        if (rest === '/monitors' && method === 'GET') return ok({ monitors: s.monitors.map((x) => Object.assign({}, x, { token: undefined })), now: now(), statsDays: s.statsDays, missed: 3 });
        if (rest === '/stats-days' && method === 'PATCH') {
            if (!owner) return err(403, 'forbidden');
            const today = Math.floor(now() / 864e5) * 864e5;
            const cut = body.days === 0 ? Infinity : today - body.days * 864e5;
            const n = s.stats.filter((x) => x.day < cut).length;
            if (n && !body.confirm) return err(409, 'confirm', { deletes: n });
            s.statsDays = body.days;
            s.stats = s.stats.filter((x) => x.day >= cut);
            return ok({ statsDays: s.statsDays, deleted: n });
        }
        if (rest === '/records' && method === 'POST') {
            if (mem.role !== 'owner' && mem.role !== 'provider') return err(403, 'forbidden');
            if (!['act', 'quiet'].includes(body.kind) || body.author !== me.id) return err(403, 'forbidden');
            fake.recordPosts = (fake.recordPosts || 0) + 1;
            return fake.putRecord(s, body);
        }
        if (rest === '/records' && method === 'GET') {
            const since = Number(q.get('since') || 0);
            return ok({ records: s.records.filter((x) => x.n > since).map((x) => ({ n: x.n, folded: !!x.folded, received: x.received, record: x.record })), last: s.records.length ? s.records[s.records.length - 1].n : since, more: false, now: now() });
        }
        if (rest === '/records/folded' && method === 'POST') {
            if (!owner) return err(403, 'forbidden');
            let n = 0;
            // An issue folded takes the acts on it along (ids "<issue>|…"), as the Go server does.
            const issues = [];
            s.records.forEach((x) => { if ((body.ns || []).includes(x.n) && !x.folded && x.record.kind !== 'status') { x.folded = true; n++; if (x.record.kind === 'issue') issues.push(x.record.id); } });
            s.records.forEach((x) => { if (x.record.kind === 'act' && issues.some((id) => x.record.id.startsWith(id + '|'))) x.folded = true; });
            fake.foldedNs = (fake.foldedNs || []).concat(body.ns || []);
            return ok({ folded: n });
        }
        if (rest === '/stats' && method === 'GET') {
            const from = Number(q.get('from')), to = Number(q.get('to'));
            return ok({ stats: s.stats.filter((x) => x.day >= from && x.day <= to).map((x) => ({ monitor: x.monitor, day: x.day, record: x.record })) });
        }
        if (rest === '/leave') { s.visits = (s.visits || []).filter((v) => v.author !== me.id); s.members.delete(me.id); return { status: 204 }; }
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
            // Only owners write revisions (docs/SCOPE.md D154; the Go server's
            // pushRev): after the base, epoch and roster checks there.
            const r0 = body.rev;
            if (mem.role !== 'owner' && r0.base === s.revs.length && r0.epoch === s.epoch && r0.rseq === s.rosters.length) {
                fake.refusedPushes = (fake.refusedPushes || 0) + 1;
                return err(403, 'owners-only', { update: true, message: 'Only owners save versions of this site. Update Topo: your visit then goes to the owner for review.' });
            }
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
        // ---- Visit copies (server/internal/api/visits.go, D154) ----
        s.visits = s.visits || [];
        const visitOut = (v) => ({ id: v.id, author: v.author, email: (S.users.get(v.author) || {}).email || '', dev: v.dev, slot: v.slot, baseN: v.baseN, epoch: v.epoch, rseq: v.rseq,
            at: v.at, received: v.received, replaced: v.replaced, size: v.size, ctHash: v.ctHash, sig: v.sig, state: v.state, decidedAt: v.decidedAt || 0, decidedBy: v.decidedBy || '', decidedN: v.decidedN || 0 });
        if (rest === '/visits' && method === 'POST') {
            if (mem.role !== 'provider') return err(403, 'forbidden');
            const c = body.copy || {};
            if (c.author !== me.id || !/^v_[A-Za-z0-9_-]{16,40}$/.test(c.id || '') || !/^[A-Za-z0-9_-]{8,64}$/.test(c.slot || '')) return err(400, 'bad-request', { field: 'copy' });
            const h = { site: s.id, id: c.id, slot: c.slot, baseN: c.baseN, epoch: c.epoch, rseq: c.rseq, author: c.author, dev: c.dev, at: c.at, ctHash: c.ctHash };
            if (!(await C().verify(me.sigPub, C().visitSigned(h), c.sig))) return err(422, 'bad-signature');
            if (c.baseN < 1 || c.baseN > s.revs.length) return err(409, 'stale-base', { head: { n: s.revs.length, h: s.headH } });
            if (c.epoch !== s.epoch) return err(409, 'stale-epoch', { epoch: s.epoch });
            if (c.rseq !== s.rosters.length) return err(409, 'stale-roster', { rosterSeq: s.rosters.length });
            const old = s.visits.find((v) => v.author === me.id && v.slot === c.slot && v.state === 'waiting');   // a decided one stays (D191)
            s.visits = s.visits.filter((v) => v !== old);
            const v = Object.assign({}, h, { body: { iv: c.iv, ct: c.ct }, sig: c.sig, received: now() + (fake.visitSeq = (fake.visitSeq || 0) + 1), replaced: old ? (old.replaced || 0) + 1 : 0,
                size: C().unb64u(c.ct).length, state: 'waiting' });
            s.visits.push(v);
            fake.mails.push({ kind: 'visit-recorded', to: 'owners', site: s.id });
            return ok(Object.assign({ visit: visitOut(v) }, old ? { replacedId: old.id } : {}), 201);
        }
        if (rest === '/visits' && method === 'GET') {
            if (mem.role === 'viewer') return ok({ visits: [] });
            return ok({ visits: s.visits.filter((v) => owner || v.author === me.id).slice().sort((a, b) => a.received - b.received).map(visitOut) });
        }
        if ((m = /^\/visits\/([^/]+)(\/decide)?$/.exec(rest))) {
            const v = s.visits.find((x) => x.id === m[1]);
            if (!v || (!owner && v.author !== me.id)) return err(404, 'not-found');
            if (m[2] && method === 'POST') {
                if (!owner) return err(403, 'forbidden');
                if (v.state !== 'waiting') return err(409, 'conflict', { state: v.state });
                if (!['approved', 'rejected'].includes(body.decision) || !(body.n >= v.baseN && body.n <= s.revs.length)) return err(422, 'bad-chain');
                Object.assign(v, { state: body.decision, decidedAt: now(), decidedBy: me.id, decidedN: body.n });
                fake.mails.push({ kind: 'visit-recorded', to: (S.users.get(v.author) || {}).email, reason: body.decision });
                return ok({ id: v.id, state: v.state, n: v.decidedN });
            }
            if (method === 'DELETE') { s.visits = s.visits.filter((x) => x !== v); return { status: 204 }; }
            return ok({ visit: visitOut(v), body: v.body });
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
        // Uploads a visit copy as a provider's browser does (js/serversync.js
        // uploadVisit): mutate(doc) changes the head's copy (or o.from, a
        // document of its own). o: { slot, baseN, incidentId, providerId, from }.
        R.uploadVisit = async (siteId, mutate, o = {}) => {
            const s = S.sites.get(siteId);
            const baseN = o.baseN || s.revs.length;
            const r0 = s.revs[baseN - 1];
            const env0 = o.from ? { v: 1, id: o.id || 'x', name: 'X', doc: o.from } : await C().unpackDoc(await C().openRevision(Object.assign({ site: siteId }, r0.hdr), r0.body, R.keys.get(siteId + '|' + r0.hdr.epoch)));
            const doc = JSON.parse(JSON.stringify(env0.doc));
            const next = mutate ? mutate(doc) || doc : doc;
            const plain = await C().packDoc({ v: 1, kind: 'visit', id: env0.id, name: env0.name, rev: 'r' + C().b64u(C().random(9)), base: env0.rev || null, prior: [], doc: next,
                baseN, incidentId: o.incidentId || null, providerId: o.providerId || null });
            const slot = o.slot || await TopoServerSync.visitSlot(siteId, o.incidentId, o.providerId);
            const id = 'v_' + C().b64u(C().random(16));
            const h = { site: siteId, id, slot, baseN, epoch: s.epoch, rseq: s.rosters.length, author: u.id, dev: 'd_remote', at: now() };
            const env = await C().sealVisit(h, R.keys.get(siteId + '|' + s.epoch), R.sig, plain);
            const old = (s.visits = s.visits || []).find((v) => v.author === u.id && v.slot === slot && v.state === 'waiting');
            s.visits = s.visits.filter((v) => v !== old);
            const v = Object.assign({}, h, { ctHash: env.ctHash, sig: env.sig, body: { iv: env.iv, ct: env.ct }, received: now() + (fake.visitSeq = (fake.visitSeq || 0) + 1),
                replaced: old ? (old.replaced || 0) + 1 : 0, size: C().unb64u(env.ct).length, state: 'waiting' });
            s.visits.push(v);
            return v;
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
    // A record kept as the Go server keeps it: one per (kind, id), a newer
    // one from the same author replacing it with a new n.
    fake.recordSeq = 0;
    fake.putRecord = (s, rec) => {
        s.records = s.records || [];
        if (rec.epoch !== s.epoch) return err(409, 'stale-epoch', { epoch: s.epoch });
        const old = s.records.find((x) => x.record.kind === rec.kind && x.record.id === rec.id);
        if (old && old.record.author !== rec.author) return err(403, 'not-author');
        if (old && rec.at <= old.record.at) return err(409, 'older-record');
        s.records = s.records.filter((x) => x !== old);
        const n = ++fake.recordSeq;
        s.records.push({ n, record: rec, received: now(), folded: false });
        return ok({ n });
    };
    // A PC turned into a site monitor, as src-tauri/src/monitorlink.rs does
    // it: device keys (enc ECDH, sig ECDSA), then, once granted, the site
    // key unwrapped and records sealed and signed by it.
    fake.remoteMonitor = async () => {
        const M = { keys: new Map() };
        const e = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
        const g = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        M.enc = e.privateKey; M.sig = g.privateKey;
        M.encPub = C().b64u(new Uint8Array(await crypto.subtle.exportKey('raw', e.publicKey)));
        M.sigPub = C().b64u(new Uint8Array(await crypto.subtle.exportKey('raw', g.publicKey)));
        // After the owner's page registered and granted it.
        M.adopt = (siteId, monitorId) => { M.site = siteId; M.id = monitorId; };
        M.unwrapKeys = async () => {
            const s = S.sites.get(M.site);
            for (const [kk, w] of Object.entries(s.wraps)) {
                if (!kk.endsWith('|' + M.id)) continue;
                const epoch = Number(kk.split('|')[0]);
                const raw = await C().unwrap(w, { priv: M.enc, pub: M.encPub, ctx: C().siteCtx(M.site, epoch, M.id), signers: [S.users.get(w.by).sigPub] });
                M.keys.set(epoch, await C().importSiteKey(raw));
            }
        };
        M.at = 0;
        M.seal = async (kind, rid, payload, o = {}) => {
            const s = S.sites.get(M.site);
            const epoch = o.epoch || s.epoch;
            M.at = Math.max(now(), M.at + 1);
            return C().sealRecord({ site: M.site, kind, id: rid, epoch, author: o.author || M.id, at: M.at }, o.key || M.keys.get(epoch), o.sigPriv || M.sig, C().utf8(JSON.stringify(payload)));
        };
        M.status = async (name, items) => {
            const s = S.sites.get(M.site);
            const r = fake.putRecord(s, await M.seal('status', M.id, { v: 1, monitor: name, at: now(), intervalMs: 60000, items }));
            const mon = s.monitors.find((x) => x.id === M.id);
            if (mon) { mon.lastReport = now(); mon.stale = false; }
            return r;
        };
        M.issue = async (payload) => fake.putRecord(S.sites.get(M.site), await M.seal('issue', payload.id, payload));
        M.stats = async (day, checks, name) => {
            const s = S.sites.get(M.site);
            const rec = await M.seal('stats', M.id + '|' + day, { v: 1, day, monitor: name || '', checks });
            s.stats = (s.stats || []).filter((x) => !(x.monitor === M.id && x.day === day));
            s.stats.push({ monitor: M.id, day, record: rec });
        };
        return M;
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
            rosters, pubs, owners,
            // The records not folded yet (D159), as snapshot.go adds them.
            records: o.records !== undefined ? o.records : (s.records || []).filter((x) => !x.folded && x.record.kind !== 'status').map((x) => x.record)
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
