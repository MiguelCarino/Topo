// A page no Topo server served is exactly the page it always was (decision
// D66, amendment E1; js/server.js, js/serversync.js, js/serverui.js). The
// static site, the offline zip and the desktop app carry the server's
// scripts, and without the server's <meta name="topo-server"> they:
//   - make no request (fetch spied) and open no EventSource;
//   - add no listener, even when every hook the app calls is called
//     (addEventListener counted on window, document and elements);
//   - leave the landing's "On this server" section hidden and empty, and
//     the cards, the doc bar and the delete question as they were;
//   - leave '#signin=' and '#invite=' to load() as before: not consumed;
//   - send no report through the server and no visit back through it.
// Also: the published surface exists, every string of the three files is
// in every locale (keys checked with CarinoI18N.has), and no Japanese
// string says パソコン.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const tick = () => new Promise((r) => setTimeout(r, 0));
  try {
    ok('no marker on this page', !document.querySelector('meta[name="topo-server"]'));
    ok('the client did not start', TopoServer.state.on === false && TopoServer.state.status === 'off');
    ok('the published surface is there', typeof openServerClient === 'function' && typeof serverHashToken === 'function' && !!window.TopoServerSync && !!window.TopoServerUI && !!window.TopoServerCrypto);

    // Spy on the network and on listeners, then call every hook.
    let fetches = 0, sources = 0, listeners = 0;
    const realFetch = window.fetch, realES = window.EventSource;
    const realAdd = EventTarget.prototype.addEventListener;
    window.fetch = function () { fetches++; return realFetch.apply(this, arguments); };
    window.EventSource = function () { sources++; return new realES(...arguments); };
    EventTarget.prototype.addEventListener = function () { listeners++; return realAdd.apply(this, arguments); };
    try {
      const opened = await openServerClient();
      ok('openServerClient answers false', opened === false);
      ok('"#signin=" is not taken (load() reads it as before)', serverHashToken('signin=abcdefghijklmnop') === false);
      ok('"#invite=" is not taken', serverHashToken('invite=i_abc.defghijklmnop') === false);
      ok('no card is on a server', serverCardIds().size === 0);
      ok('no sync line on a card', serverCardText('x') === null);
      serverAfterSave('x'); serverDocLoaded('library');
      let tools = 0; serverCardTools({ id: 'x', doc: { nodes: [] } }, () => { tools++; });
      ok('no server tools on a card', tools === 0);
      ok('the delete question is the usual one', (await serverDeleteQuestion({ id: 'x', name: 'X' })) === false);
      ok('no report goes through a server', serverSendRoute('x', ['p']) === null && serverReturnRoute('x') === false);
      serverPushNow('x'); serverLocale(); renderServerSection();
      const bar = document.getElementById('docBar'), status = document.getElementById('docBarStatus');
      serverDocBar(bar, status);
      ok('the doc bar has no sync chip', !document.getElementById('docBarSync'));
      await tick(); await tick();
    } finally {
      window.fetch = realFetch; window.EventSource = realES; EventTarget.prototype.addEventListener = realAdd;
    }
    ok('no request was made', fetches === 0, String(fetches));
    ok('no event stream was opened', sources === 0, String(sources));
    ok('no listener was added', listeners === 0, String(listeners));

    // The landing as it always was.
    openLanding(false);
    const sec = document.getElementById('landingServer');
    ok('"On this server" stays hidden', sec.hidden && getComputedStyle(sec).display === 'none');
    ok('and empty', document.getElementById('serverCards').children.length === 0);
    ok('no server sheet open', document.getElementById('serverSheet').hidden);
    closeLanding();
    ok('the read-only banner keeps its usual words', !document.getElementById('readOnlyWhy').hidden && document.getElementById('readOnlyViewer').hidden);
    ok('no CSP violation', (window.__cspViolations || []).length === 0, (window.__cspViolations || []).join(' | '));

    // Every string a client sees, in every locale.
    const keys = new Set();
    Object.values(TopoServerUI.ERR).forEach((k) => keys.add(k));
    Object.values(TopoServerUI.STATE_TEXT).forEach((k) => keys.add(k));
    TopoServerUI.NOTIFY.forEach(([, k]) => keys.add(k));
    ['On this server', '☁ Put a network on the server', 'Sign in to Topo', 'Your recovery key', 'Open your account on this browser', 'Account', 'Members',
      'Give access', 'Yes, give access', 'Give access without checking', 'Safety code: {code}', 'Your safety code: {code}', 'History on the server',
      'Waiting for the owner to give you access.', 'the server', 'Before merging from the server', 'Sent through the server. {names} will get an email.',
      'Saved to the server. The client will get an email.', 'Something went wrong on the server. Try again.', 'Too many tries. Wait {minutes} min.',
      'You are a viewer on the server: you can look at this network, report on it and export it, but changes are not kept.',
      'You can look at this network but not change it: you are a viewer on the server.', 'Owner', 'Provider', 'Viewer'].forEach((k) => keys.add(k));
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = [...keys].filter((k) => !CarinoI18N.has(loc, k));
      ok(`${loc} carries every server string`, !miss.length, miss.slice(0, 3).join(' | '));
    });
    ok('Japanese never says パソコン', ![...keys].some((k) => String((CarinoI18N.MESSAGES.ja || {})[k] || '').includes('パソコン')));
    ok('"the server" names a merge source', TopoMergeApply.logEntryText({ kind: 'merge', source: 'server', counts: {} }).includes('the server'));
    ok('a server revision is a kept kind', CarinoRevisions.REVISION_WHY.includes('server'));
    ok('a merge from the server is a restore point reason', CarinoRestore.RESTORE_REASONS.includes('Before merging from the server') && TopoMergeApply.MERGE_REASONS.includes('Before merging from the server'));
  } catch (e) {
    ok('the suite ran', false, (e && e.stack) || String(e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
