// Check in Ping (js/watch.js pingLinkOf; docs/SCOPE.md step 9j, D447):
//   1. each watched address has a link to ping.carino.systems with the
//      address after the hash, encoded; a new tab, no opener;
//   2. in a read-only network too;
//   3. it is a link and nothing more: the page's Content-Security-Policy
//      still lets it connect only to itself and the release check, and
//      nothing in js/watch.js fetches;
//   4. the strings in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const tick = () => new Promise((r) => setTimeout(r, 30));
  try {
    setLocale('en');
    replaceDocument({ v: DOC_VERSION, nodes: [{ id: 'r', type: 'router', name: 'R', x: 0, y: 0, interfaces: [] }], links: [],
      watch: [{ id: 'wa1', name: 'Resolver', address: '9.9.9.9' }, { id: 'wa2', name: 'Mail', address: 'mail.example.com' }, { id: 'wa3', name: 'Six', address: '2001:db8::53' }] },
      { origin: 'file', docId: 'doc-pinglink' });
    renderCanvasOnly();
    el('watchTabBtn').click(); await tick();
    TopoWatch.render(true); await tick();
    const links = [...el('watchList').querySelectorAll('a.wt-ping')];
    ok('each watched address has the link', links.length === 3 && links.every((a) => /Check in Ping ↗/.test(a.textContent)), String(links.length));
    ok('the address goes after the hash, encoded', links[0].getAttribute('href') === 'https://ping.carino.systems/#host=9.9.9.9' && links[1].getAttribute('href') === 'https://ping.carino.systems/#host=mail.example.com'
      && links[2].getAttribute('href') === 'https://ping.carino.systems/#host=2001%3Adb8%3A%3A53', links.map((a) => a.getAttribute('href')).join(' '));
    ok('nothing but the address is in it', links.every((a) => { const u = new URL(a.href); return u.search === '' && u.pathname === '/' && /^#host=[^&]+$/.test(u.hash); }));
    ok('a new tab, with no opener and no referrer', links.every((a) => a.target === '_blank' && /noopener/.test(a.rel) && /noreferrer/.test(a.rel)));
    ok('its title says Topo contacts nothing', /Topo itself contacts nothing/.test(links[0].title));

    // ---- 2. Read-only ----
    state.readOnly = { doc: {}, loaded: '' };
    TopoWatch.render(true); await tick();
    ok('a read-only network has it too', el('watchList').querySelectorAll('a.wt-ping').length === 3);
    state.readOnly = null;

    // ---- 3. A link and nothing more ----
    const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
    ok('the page may still connect only to itself and the release check', /connect-src 'self' https:\/\/api\.github\.com;/.test(csp) && !/connect-src[^;]*ping\.carino/.test(csp), csp);
    const src = await (await fetch('js/watch.js')).text();
    ok('js/watch.js fetches nothing', !/\bfetch\(|XMLHttpRequest|new Image\(|WebSocket|sendBeacon/.test(src));

    // ---- 4. Translations ----
    const { has, locales } = window.CarinoI18N;
    locales.forEach((loc) => ok(`${loc} carries the strings`, has(loc, 'Check in Ping ↗') && has(loc, 'Opens ping.carino.systems with this address filled in. Topo itself contacts nothing.')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    state.readOnly = null;
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
