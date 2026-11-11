// @realtime @touch 360x780
// Backups on a Topo server, in the browser (js/serverui.js openBackups and
// openSiteBackups, js/serversync.js readable copies; docs/SCOPE.md step 5b,
// D99, D105, D106), against the in-page fake server (tests/fixtures/
// fakeserver.js), on a phone. Covered:
//   - switching Where away and back keeps the saved fields; a folder saved
//     anyway says to connect the disk and save again;
//   - only the server owner sees Account, Backups and can open the sheet;
//   - the fields of each kind (folder: path with the allowed folders under
//     it; WebDAV: address, user, app password, certificate fingerprint);
//   - a password is sent once and never shown again: "Saved (type to
//     replace)", the field empty, a later Save without it sends no secret;
//   - Save with a failing check asks "Save anyway?", No saves nothing, Yes
//     saves with ?force=1; Test says the problem in words; a folder outside
//     the allowed ones is said in words;
//   - the status lines in words (last backup, last problem, next run, the
//     check); Back up now and Check now;
//   - the readable-copy permission shows its warning;
//   - 5c: S3's fields and path-style tick, its secret sent once; Google
//     Drive and OneDrive: client ID/secret (tenant), the redirect address to
//     register, Connect to the provider's page, back with
//     '#backup-connect=' (taken off the URL), connected as whom, the same
//     answer twice refused, a refusal said; the setup links; a locked
//     bucket in the status;
//   - the network owner's Backups: the list, Restore…/Download, "Keep a
//     readable copy too" asks first; the readable copy is then sent after a
//     push, of the head, as the export file; turning it off can delete them;
//   - "Open the latest backup here" opens it for real (WebCrypto) and says so;
//   - the name in file-name form (nameSlug) is sent with "Show the name";
//   - Spanish;
//   - the two sheets and Settings, Back-ups through tests/fixtures/
//     touchaudit.js at 360 and 390;
//   - no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const body = () => el('serverSheetBody');
  const sheetShown = () => !el('serverSheet').hidden;
  const text = () => body().textContent;
  const button = (label) => [...body().querySelectorAll('button')].find((b) => b.textContent === label);
  const field = (k) => body().querySelector(`[data-k="${k}"]`);
  const setVal = async (input, v) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); await settle(); };
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const both = async (label, open) => {
    for (const w of [360, 390]) { await window.__viewport(w, w === 360 ? 780 : 844); await settle(); if (open) await open(); await audit(label); }
  };
  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    await loadScript('tests/fixtures/fakeserver.js');
    const T = TopoServer, Y = TopoServerSync, U = TopoServerUI;
    const fake = FakeTopoServer({ ownerEmail: 'owner@example.test' });
    function NoStream() { this.addEventListener = () => {}; this.close = () => {}; this.readyState = 1; }
    T._reset(); Y._reset();
    Object.assign(T._hooks, { force: true, fetch: fake.fetch, EventSource: NoStream, BroadcastChannel: null, locks: null });
    Object.assign(Y._hooks, { quietMs: 30, maxMs: 200, busyMs: 200, readableMs: 400, readableDelayMs: 50 });
    U.setServerResponder((q) => (q.kind === 'recovery' ? 'ok' : q.kind === 'show-name' ? false : null));
    let confirmAnswer = true;
    const asked = [];
    setDialogResponder((q) => { asked.push(q); return q.kind === 'confirm' ? confirmAnswer : q.kind === 'tell' ? undefined : null; });
    if (window.CarinoRestore) await CarinoRestore.openRestoreStore({ open: async () => [], readCards: async () => ({}), readDoc: async () => null, write: async () => true });
    await openServerClient();
    await T.verifyCode(await T.requestCode('owner@example.test'), '123456', 'owner@example.test');
    ok('signed in, the server owner', T.state.status === 'ready' && T.me().serverRole === 'owner', T.state.status);

    // ---- Only the server owner ----
    const me = fake.user('owner@example.test');
    me.serverRole = 'staff'; await T.refreshMe();
    U.openAccount();
    ok('a staff member\'s account has no Backups', await until(() => sheetShown() && /Language for emails/.test(text())) && !button('Backups…'));
    U.closeSheet();
    U.openBackups(); await settle();
    ok('nor can open the sheet', !sheetShown());
    me.serverRole = 'owner'; await T.refreshMe();
    U.openAccount();
    ok('the server owner\'s account says Backups: off', await until(() => !!button('Backups…')) && /Backups: off/.test(text()), text().slice(0, 300));
    button('Backups…').click();
    ok('the Backups sheet opens', await until(() => el('serverSheetTitle').textContent === 'Backups' && !!field('kind')));
    const kinds = [...field('kind').options].map((o) => o.value);
    ok('Where: Off, a folder, Google Drive, OneDrive, S3, WebDAV', kinds.join(',') === ',folder,gdrive,onedrive,s3,webdav', kinds.join(','));
    ok('Off shows no fields and no Test', !field('f-path') && !field('f-url') && !button('Test') && !!button('Save'));

    // ---- Folder ----
    await setVal(field('kind'), 'folder');
    ok('a folder: its path, with the allowed folders under it', !!field('f-path') && /Allowed: \/srv\/topo\/backups/.test(text()));
    ok('the daily time, 02:30 to start', !!field('daily') && field('daily').value === '02:30');
    await setVal(field('f-path'), '/etc');
    button('Save').click();
    ok('a folder the server may not use is said in words', await until(() => /may not write to that folder/.test(text())), text().slice(-300));
    await setVal(field('f-path'), '/srv/topo/backups/usb');
    button('Save').click();
    ok('saved', await until(() => /Saved\./.test(text())) && fake.backup.config.enabled && fake.backup.config.kind === 'folder' && fake.backup.config.fields.path === '/srv/topo/backups/usb');
    ok('Back up now and Check now are offered once on', !!button('Back up now') && !!button('Check now'));
    await both('the Backups sheet, a folder');

    // ---- WebDAV and its password ----
    await setVal(field('kind'), 'webdav');
    const pw = field('f-password');
    ok('WebDAV: address, user, app password, certificate fingerprint', !!field('f-url') && !!field('f-user') && !!pw && !!field('f-fingerprint'));
    ok('the password field is a password, never offered by the password manager', pw.type === 'password' && pw.getAttribute('autocomplete') === 'new-password');
    ok('fields are 16px', [field('f-url'), field('f-user'), pw].every((x) => parseFloat(getComputedStyle(x).fontSize) >= 16));
    await setVal(field('f-url'), 'https://cloud.example.test/remote.php/dav/files/ana/Topo');
    await setVal(field('f-user'), 'ana');
    await setVal(field('f-password'), 'sekret-app-pw');
    fake.backupFails = 'refused';
    button('Test').click();
    ok('Test with a refusing destination says so in words', await until(() => /refused the user name or password/.test(text())));
    confirmAnswer = false; asked.length = 0;
    const saves = fake.backup.saves || 0;
    button('Save').click();
    ok('Save with a failing check asks "Save anyway?"', await until(() => asked.some((q) => q.kind === 'confirm' && /Save anyway/.test(q.message) && /refused/.test(q.message))));
    ok('…and No saves nothing', await until(() => /refused/.test(text())) && (fake.backup.saves || 0) === saves && fake.backup.config.kind === 'folder');
    confirmAnswer = true;
    button('Save').click();
    ok('Yes saves with ?force=1', await until(() => fake.backup.config.kind === 'webdav') && fake.calls.some((c) => c.method === 'PUT' && /force=1/.test(c.path)));
    fake.backupFails = null;
    const put = fake.calls.filter((c) => c.method === 'PUT' && /admin\/backups/.test(c.path)).pop();
    ok('the password went to the server once', put.body.secrets && put.body.secrets.password === 'sekret-app-pw');
    await until(() => /Saved\./.test(text()));
    ok('it is never shown again: an empty field saying "Saved (type to replace)"', field('f-password').value === '' && field('f-password').placeholder === 'Saved (type to replace)');
    ok('nor anywhere in the sheet', !body().innerHTML.includes('sekret-app-pw'));
    button('Save').click();
    await until(() => fake.calls.filter((c) => c.method === 'PUT').length > 2);
    await settle();
    const put2 = fake.calls.filter((c) => c.method === 'PUT' && /admin\/backups/.test(c.path)).pop();
    ok('a later Save without typing it sends no secret (the saved one stays)', !put2.body.secrets && fake.backup.config.secrets.password === 'sekret-app-pw');
    // Away to another kind and back: the saved address and user come back.
    await setVal(field('kind'), 'folder');
    await setVal(field('kind'), 'webdav');
    ok('switching away and back to the saved kind brings its fields back', field('f-url').value === 'https://cloud.example.test/remote.php/dav/files/ana/Topo' && field('f-user').value === 'ana'
      && field('f-password').placeholder === 'Saved (type to replace)', field('f-url').value);
    await both('the Backups sheet, WebDAV');

    // ---- Readable copies: the permission, with its warning ----
    ok('no warning while readable copies are not allowed', !/passwords in notes included/.test(text()));
    field('readable').click(); await settle();
    ok('ticking "Also allow readable copies" shows the warning', /anyone with access to the drive, passwords in notes included/.test(text()));
    button('Save').click();
    ok('saved with readable copies allowed', await until(() => fake.backup.config.readableAllowed === true));

    // ---- Status in words ----
    fake.backup.status.lastOk = Date.now() - 3600e3;
    fake.backup.status.lastError = { at: Date.now() - 600e3, code: 'not-found' };
    fake.backup.status.lastCheck = { at: Date.now() - 60e3, ok: false, code: 'mismatch' };
    fake.backup.status.markerOwed = true;
    U.openBackups();
    ok('a folder saved anyway says to connect the disk and save again', await until(() => /connect the disk, then press Save again/.test(text())));
    fake.backup.status.markerOwed = false;
    U.closeSheet();
    U.openBackups();
    ok('the status lines', await until(() => /Last backup:/.test(text()) && /Last problem: The backup folder is not there \(is the disk connected\?\)/.test(text())
      && /Next daily backup:/.test(text()) && /Last check: failed, A backup read back is not the file that was written\./.test(text())), text().slice(-500));
    button('Back up now').click();
    ok('Back up now asks the server and says so', await until(() => fake.backup.runs === 1 && /Backing up now/.test(text())));
    button('Check now').click();
    ok('Check now too', await until(() => fake.backup.checks === 1 && /Checking now/.test(text())));
    U.closeSheet();

    // ---- 5c: S3, Google Drive, OneDrive (D110, D111) ----
    U.openBackups();
    await until(() => !!field('kind'));
    await setVal(field('kind'), 's3');
    ok('S3: endpoint, region, bucket, folder, key id, secret, path style, fingerprint', ['endpoint', 'region', 'bucket', 'prefix', 'keyId', 'secret', 'pathStyle', 'fingerprint'].every((k) => !!field('f-' + k)));
    ok('the path-style tick says what it is for', /Needed for MinIO and most self-hosted stores/.test(text()));
    const help = field('help');
    ok('a plain link to the setup steps (a new tab, not a fetch)', !!help && /docs\/SERVER\.md#s3-compatible-storage$/.test(help.href) && help.target === '_blank' && /noopener/.test(help.rel));
    ok('the secret is a password field', field('f-secret').type === 'password' && field('f-secret').getAttribute('autocomplete') === 'new-password');
    await setVal(field('f-endpoint'), 'https://minio.example.lan:9000');
    await setVal(field('f-bucket'), 'topo-backups');
    await setVal(field('f-keyId'), 'AKIDEXAMPLE');
    await setVal(field('f-secret'), 's3-secret-value');
    field('f-pathStyle').click(); await settle();
    button('Save').click();
    ok('S3 saved: the tick as "1", the secret sent once', await until(() => fake.backup.config.kind === 's3') && fake.backup.config.fields.pathStyle === '1' && fake.backup.config.secrets.secret === 's3-secret-value');
    await until(() => /Saved\./.test(text()));
    ok('the S3 secret is never shown again', field('f-secret').value === '' && field('f-secret').placeholder === 'Saved (type to replace)' && !body().innerHTML.includes('s3-secret-value'));
    ok('the tick stays ticked', field('f-pathStyle').checked === true);
    fake.backup.status.dropNote = 'locked';
    U.openBackups();
    ok('a bucket that keeps files locked is said once in the status', await until(() => /The bucket keeps files locked; Topo cannot delete old backups there\./.test(text())));
    fake.backup.status.dropNote = '';
    await both('the Backups sheet, S3');

    await setVal(field('kind'), 'onedrive');
    ok('OneDrive: client ID, client secret, tenant; not connected yet; Connect', !!field('f-clientId') && !!field('f-clientSecret') && !!field('f-tenant') && /Not connected yet/.test(text()) && !!button('Connect'));
    ok('it says Topo sees only its own folder', /Topo asks only for its own folder/.test(text()));
    ok('it shows the redirect address to register (localhost on this machine)', /Redirect address to register in the app: http:\/\/localhost(:\d+)?\/api\/backups\/oauth\/callback/.test(text()), text().slice(0, 900));
    let went = null;
    T._hooks.navigate = (u) => { went = u; };
    button('Connect').click();
    ok('Connect without the client secret asks for it', await until(() => /Check “Client secret”/.test(text())) && !went, text().slice(-300));
    await setVal(field('f-clientId'), 'app-client-1');
    await setVal(field('f-clientSecret'), 'ms-app-secret');
    button('Connect').click();
    ok('Connect goes to the provider\'s sign-in page', await until(() => !!went) && /^https:\/\/provider\.example\.test\/auth\?state=/.test(went) && /Opening the sign-in page of Microsoft/.test(text()));
    const startCall = fake.calls.filter((c) => /oauth\/start/.test(c.path)).pop();
    ok('…sending what was typed, the secret once', startCall.body.kind === 'onedrive' && startCall.body.fields.clientId === 'app-client-1' && startCall.body.secrets.clientSecret === 'ms-app-secret');
    await both('the Backups sheet, OneDrive');
    U.closeSheet();
    // Back from the provider: the boot takes the fragment off the URL.
    const frag = fake.oauthBack(went);
    history.replaceState(history.state, '', '#' + frag);
    await load();
    ok('the fragment is taken off the address', !location.hash, location.hash);
    ok('back from the provider: connected, the sheet says as whom', await until(() => sheetShown() && /Connected as ana@example\.test\./.test(text())), text().slice(0, 400));
    ok('the server keeps the sign-in; the browser never sees it', fake.backup.config.kind === 'onedrive' && !!fake.backup.config.secrets.refreshToken && !body().innerHTML.includes(fake.backup.config.secrets.refreshToken));
    ok('Connect again is offered once connected', !!button('Connect again') && !button('Connect'));
    // The same answer again is refused (single use).
    await U.backupConnectArrived(frag.slice('backup-connect='.length));
    ok('the same answer twice is refused in words', await until(() => /took too long or was already used/.test(text())));
    // The owner said no.
    went = null;
    button('Connect again').click();
    await until(() => !!went);
    await U.backupConnectArrived(fake.oauthBack(went, 'access_denied').slice('backup-connect='.length));
    ok('a refusal at the provider is said in words', await until(() => /did not allow Topo/.test(text())));
    T._hooks.navigate = null;
    await setVal(field('kind'), 'gdrive');
    ok('Google Drive: client ID and secret; its own setup link', !!field('f-clientId') && !!field('f-clientSecret') && !field('f-tenant') && /#google-drive$/.test(field('help').href));
    await setVal(field('kind'), 'onedrive');
    ok('the drive codes are sentences', /press Connect again/.test(U.backupErrText({ code: 'backup-dest', data: { code: 'connect' } }))
      && /client secret may have expired/.test(U.backupErrText({ code: 'backup-dest', data: { code: 'client-secret' } }))
      && /clock is wrong/.test(U.backupErrText({ code: 'backup-dest', data: { code: 'clock' } })));
    U.closeSheet();

    // ---- A network on the server, its backups ----
    replaceDocument(templatesData.house, { origin: 'default' });
    const id = claimDocument('Clínica Sol', null);
    U.setServerResponder((q) => (q.kind === 'show-name' ? true : q.kind === 'recovery' ? 'ok' : null));
    await U.putOnServer(id);
    U.setServerResponder((q) => (q.kind === 'recovery' ? 'ok' : q.kind === 'show-name' ? false : null));
    const siteId = Y.rec(id).siteId;
    ok('showing the name sends it in file-name form too', fake.site(siteId).nameSlug === 'clinica-sol', fake.site(siteId).nameSlug);
    await Y.setShowName(siteId, false);
    ok('hiding the name drops it', !fake.site(siteId).nameSlug);
    await fake.addBackup(siteId);
    U.openMembers(siteId);
    ok('Members has Backups for an owner', await until(() => sheetShown() && !!button('Backups…') && /backs this network up, encrypted/.test(text())));
    button('Backups…').click();
    ok('the network\'s backups are listed', await until(() => !!button('Restore…') && !!button('Download') && /Encrypted/.test(text())), text().slice(0, 300));
    ok('"Keep a readable copy too" is offered (the server allows them)', !!field('readable') && field('readable').checked === false);
    await both('a network\'s Backups');
    // Turned on: asked first, with the warning.
    asked.length = 0; confirmAnswer = false;
    field('readable').click();
    ok('turning it on asks first, saying who could read it', await until(() => asked.some((q) => q.kind === 'confirm' && /whoever runs the server could read it/.test(q.message))));
    await settle();
    ok('No leaves it off', !fake.site(siteId).backupReadable && !field('readable').checked);
    confirmAnswer = true;
    field('readable').click();
    ok('Yes turns it on', await until(() => fake.site(siteId).backupReadable === true));
    // A push: the readable copy follows, of the head, as the export file.
    const lib = loadLibrary(); lib[id].doc.nodes[0].name = 'Readable now'; lib[id].updated = Date.now(); persistLibrary(lib);
    ok('a push', (await Y.syncNow(id)) === 'pushed');
    ok('the readable copy is sent after it', await until(() => fake.backup.readables.length >= 1));
    const rc = fake.backup.readables[fake.backup.readables.length - 1];
    ok('of the head, named as a download, the export envelope', rc && rc.revN === fake.site(siteId).revs.length && /^topo_.*clinica-sol_\d{4}-\d{2}-\d{2}\.json$/.test(rc.fileName)
      && rc.file.kind === 'nettopology' && rc.file.doc.nodes.some((n) => n.name === 'Readable now') && /topo-v\d+\.json/.test(rc.file.$schema || ''), rc && [rc.fileName, rc.revN]);
    const before = fake.backup.readables.length;
    const lib2 = loadLibrary(); lib2[id].doc.nodes[0].name = 'Again'; lib2[id].updated = Date.now(); persistLibrary(lib2);
    await Y.syncNow(id);
    await wait(150);
    ok('not again within readableMs', fake.backup.readables.length === before);
    ok('…but once it has passed', await until(() => fake.backup.readables.length === before + 1));
    U.openMembers(siteId);
    await until(() => !!button('Backups…'));
    ok('Members says a readable copy is kept', /keeps a readable copy too/.test(text()));
    button('Backups…').click();
    await until(() => !!field('readable'));
    ok('the readable copies are listed too', /Readable/.test(text()));
    asked.length = 0;
    field('readable').click();
    ok('turning it off offers to delete the readable copies made', await until(() => asked.some((q) => q.kind === 'confirm' && /Delete the readable copies already made/.test(q.message))));
    ok('…which are deleted', await until(() => !fake.backup.files.some((f) => f.site === siteId && f.kind === 'readable')) && !fake.site(siteId).backupReadable);
    U.closeSheet();
    // Off: pushes do not fetch the network's details again and again for it.
    const detailGets = () => fake.calls.filter((c) => c.method === 'GET' && c.path === `/api/sites/${siteId}`).length;
    const g0 = detailGets();
    for (const name of ['Off one', 'Off two', 'Off three']) {
      const l = loadLibrary(); l[id].doc.nodes[0].name = name; l[id].updated = Date.now(); persistLibrary(l);
      await Y.syncNow(id);
      await wait(450);
    }
    ok('with the readable copy off, pushes do not keep fetching the network for it', detailGets() <= g0 + 1 && fake.backup.readables.every((r) => !/Off /.test(JSON.stringify(r.file.doc.nodes[0].name))), `${g0} -> ${detailGets()}`);

    // ---- Open the latest backup here (a real decrypt) ----
    U.openBackups();
    await until(() => !!button('Open the latest backup here'));
    asked.length = 0;
    button('Open the latest backup here').click();
    ok('"Open the latest backup here" opens it and says so', await until(() => asked.some((q) => q.kind === 'tell' && /The backup opens\./.test(q.message) && /devices\./.test(q.message))), JSON.stringify(asked.map((q) => q.message)).slice(0, 300));

    // ---- Settings, Back-ups (on this Chromium the API exists) ----
    const hadPicker = typeof window.showDirectoryPicker === 'function';
    if (!hadPicker) window.showDirectoryPicker = async () => null;
    openSettings(); await settle();
    ok('Settings shows Back-ups where the folder API exists', !el('setBackupSec').hidden && /\(none\)/.test(el('setBackupDirName').textContent));
    el('setBackupSec').scrollIntoView();
    await both('Settings, Back-ups', async () => { openSettings(); el('setBackupSec').scrollIntoView(); });
    closeSettings();
    if (!hadPicker) delete window.showDirectoryPicker;

    // ---- Words ----
    ok('a destination code is a sentence', U.backupErrText({ code: 'backup-dest', data: { code: 'full' } }) === 'The destination is full.');
    ok('…with the certificate shown to compare', /It showed this certificate: ab12/.test(U.backupErrText({ code: 'backup-dest', data: { code: 'certificate', fingerprint: 'ab12' } })));
    ok('an unknown code is "Something went wrong."', U.backupErrText({ code: 'backup-dest', data: { code: 'zzz' } }) === 'Something went wrong.');
    setLocale('es'); applyLocale('es');
    U.openBackups();
    ok('the sheet in Spanish', await until(() => el('serverSheetTitle').textContent === 'Copias de seguridad' && /Dónde/.test(text())), el('serverSheetTitle').textContent);
    ok('errors in Spanish', U.backupErrText({ code: 'backup-dest', data: { code: 'full' } }) === 'El destino está lleno.');
    await both('the Backups sheet in Spanish');
    U.closeSheet();
    for (const loc of ['ja', 'ru', 'pt-BR']) {
      setLocale(loc);
      ok(`${loc}: the sheet's words are translated`, ['Backups', 'Keep a readable copy too', 'Saved (type to replace)', 'Open the latest backup here', 'The destination is full.', 'Connect', 'Connect again', 'Connected as {account}.', 'Path-style addresses', 'How to set this up', 'The bucket keeps files locked; Topo cannot delete old backups there.'].every((k) => t(k) !== k || CarinoI18N.has(loc, k)));
    }
    setLocale('en'); applyLocale('en');
    ok('Japanese says PC, never パソコン', !Object.values(CarinoI18N.MESSAGES.ja).some((v) => /パソコン/.test(v)));

    setDialogResponder(null);
    ok('no console error', !errors.length, errors.slice(0, 4).join(' | '));
    ok('no CSP violation', (window.__cspViolations || []).length === 0, (window.__cspViolations || []).join(' | '));
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
