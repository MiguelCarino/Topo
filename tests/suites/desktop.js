// The web side of the offline builds (desktop/, docs: README "Offline and
// desktop builds"): what the zip and the desktop app need from the page, and
// that none of it changes the website.
//   1. publicBaseFor / publicQueryFor (js/state.js): on http(s) this page's
//      own address and query (the public site, an intranet copy); from a file
//      (the zip) or the app (tauri://, http://tauri.localhost) the public site,
//      with only the view's query (profile, simple) kept;
//   2. under run.sh (http) a label's QR address and a share link still start
//      with this page's own origin and path;
//   3. saveBlob hands over a file through an <a download> that leaves the
//      page, and lets the URL go later, not at once (WebKit reads it after
//      click() returns); dataUrlToBlob decodes base64 and plain data: URLs;
//   4. the JSON and CSV downloads go through it, with their names and bytes;
//   5. on the web the report preview is still a blob: frame, and Print with
//      no __TAURI__ prints the frame; the page asks the app once whether it
//      prints (host_prints) and sends the report (host_print) only when it
//      does, printing nothing itself; an app that does not, or fails, gets
//      the frame printed and never the report; the header is stored either way.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const loc = (href) => { const u = new URL(href); return { protocol: u.protocol, hostname: u.hostname, origin: u.origin, pathname: u.pathname, search: u.search }; };
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL, realClick = HTMLAnchorElement.prototype.click;
  const heldTauri = window.__TAURI__;
  try {
    // ---- 1: the public address ----
    const site = loc('https://topo.carino.systems/?lang=es&profile=simple');
    ok('the public site keeps its own address and every query', publicBaseFor(site) === 'https://topo.carino.systems/' && publicQueryFor(site) === '?lang=es&profile=simple');
    const intra = loc('http://topo.carino.internal/topo/index.html?profile=simple');
    ok('an intranet copy keeps its own origin and path', publicBaseFor(intra) === 'http://topo.carino.internal/topo/index.html' && publicQueryFor(intra) === '?profile=simple');
    const file = loc('file:///x/index.html?lang=en&profile=simple');
    ok('the zip (file://) points at the public site, keeping only the view', publicBaseFor(file) === 'https://topo.carino.systems/' && publicQueryFor(file) === '?profile=simple', publicBaseFor(file) + publicQueryFor(file));
    const app = loc('tauri://localhost/index.html?lang=en&profile=simple');
    ok('so does the app on macOS and Linux (tauri://)', publicBaseFor(app) === 'https://topo.carino.systems/' && publicQueryFor(app) === '?profile=simple');
    const win = loc('http://tauri.localhost/index.html?simple=1');
    ok('and on Windows (http://tauri.localhost)', publicBaseFor(win) === 'https://topo.carino.systems/' && publicQueryFor(win) === '?simple=1');
    ok('no query to keep is no query', publicQueryFor(loc('file:///x/index.html?lang=ja')) === '' && publicQueryFor(loc('tauri://localhost/index.html')) === '');

    // ---- 2: under run.sh, the page's own address ----
    ok('this run is served over http', location.protocol === 'http:', location.protocol);
    ok("a label's QR address starts with this page's origin", assetLinkFor('SW-1').startsWith(location.origin + location.pathname + '#asset/SW-1'), assetLinkFor('SW-1'));
    ok('and publicBase() is that address', publicBase() === location.origin + location.pathname && publicQuery() === location.search);

    // ---- 3: saveBlob, dataUrlToBlob ----
    const made = [], revoked = [], clicked = [];
    URL.createObjectURL = (b) => { const u = realCreate.call(URL, b); made.push({ u, b }); return u; };
    URL.revokeObjectURL = (u) => { revoked.push(u); };
    HTMLAnchorElement.prototype.click = function () { clicked.push({ href: this.href, name: this.download, inPage: document.body.contains(this) }); };
    const url = saveBlob(new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    ok('saveBlob clicks an <a download> in the page, with the name', clicked.length === 1 && clicked[0].name === 'note.txt' && clicked[0].href === url && clicked[0].inPage, JSON.stringify(clicked));
    ok('and takes it out again', !document.querySelector(`a[href="${url}"]`));
    ok('the URL is not let go at once', !revoked.includes(url) && SAVE_REVOKE_MS >= 10000, String(SAVE_REVOKE_MS));
    const png = dataUrlToBlob('data:image/png;base64,iVBORw0KGgo=');
    const pngBytes = new Uint8Array(await png.arrayBuffer());
    ok('dataUrlToBlob decodes base64 with its type', png.type === 'image/png' && pngBytes.length === 8 && pngBytes[1] === 0x50 && pngBytes[7] === 0x0a, png.type + ' ' + pngBytes.length);
    const svg = dataUrlToBlob('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E');
    ok('and a plain data: URL', svg.type === 'image/svg+xml' && (await svg.text()) === '<svg/>');

    // ---- 4: the downloads go through it ----
    replaceDocument(templatesData.house, { origin: 'file' });
    clicked.length = 0; made.length = 0;
    exportJsonFile();
    ok('Export saves the JSON through saveBlob, not empty', clicked.length === 1 && /\.nettopo\.json$/.test(clicked[0].name) && made.length === 1 && made[0].b.size > 100, JSON.stringify(clicked));
    ok('its URL still alive after the click', made.length === 1 && !revoked.includes(made[0].u));
    const json = made.length ? JSON.parse(await made[0].b.text()) : {};
    ok('with the document in it', json.kind === 'nettopology' && json.doc && json.doc.nodes.length === state.nodes.length);
    clicked.length = 0; made.length = 0;
    downloadCsv('devices');
    ok('a CSV download too, with its name and rows', clicked.length === 1 && /-devices\.csv$/.test(clicked[0].name) && made.length === 1 && made[0].b.size > 50 && !revoked.includes(made[0].u), JSON.stringify(clicked));
    URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; HTMLAnchorElement.prototype.click = realClick;

    // ---- 5: the report preview and Print ----
    delete window.__TAURI__;
    openReportDialog();
    const b = await refreshReportPreview();
    const frame = el('reportPreviewFrame');
    ok('on the web the preview is still a blob: frame', !!b && /^blob:/.test(frame.getAttribute('src') || '') && !frame.hasAttribute('srcdoc'));
    let printed = 0;
    const stub = () => { try { frame.contentWindow.print = () => { printed++; }; } catch (e) { /* not reachable */ } };
    frame.addEventListener('load', stub);
    stub();
    const printOnce = async () => { printed = 0; await printReportFromDialog(); return printed; };
    ok('with no __TAURI__ Print prints the frame', (await printOnce()) === 1);
    const asked = [];
    const fakeApp = (prints) => ({ core: { invoke: async (cmd, args) => { asked.push({ cmd, args }); return cmd === 'host_prints' ? prints : true; } } });
    window.__TAURI__ = fakeApp(true);
    el('report-site').value = 'Mac Site'; el('report-site').dispatchEvent(new Event('input', { bubbles: true }));
    const n1 = await printOnce();
    const sent = asked.filter((a) => a.cmd === 'host_print');
    ok('an app that prints (macOS) gets the report, and the frame is not printed', n1 === 0 && sent.length === 1
       && /Mac Site/.test(sent[0].args.html) && /-report-\d{4}-\d{2}-\d{2}\.html$/.test(sent[0].args.name), JSON.stringify(asked.map((a) => [a.cmd, a.args && a.args.name])) + ' ' + n1);
    ok('the header is stored all the same', state.report && state.report.site === 'Mac Site');
    asked.length = 0;
    await printOnce();
    ok('it asks whether the app prints only once', asked.length === 1 && asked[0].cmd === 'host_print', JSON.stringify(asked.map((a) => a.cmd)));
    asked.length = 0;
    window.__TAURI__ = fakeApp(false);
    const n2 = await printOnce(), n3 = await printOnce();
    ok('an app that does not (Windows, Linux) leaves it to the frame, and never gets the report', n2 === 1 && n3 === 1
       && asked.length === 1 && asked[0].cmd === 'host_prints', JSON.stringify(asked.map((a) => a.cmd)));
    window.__TAURI__ = { core: { invoke: async () => { throw new Error('no such command'); } } };
    ok('and one that fails too', (await printOnce()) === 1);
    window.__TAURI__ = { core: { invoke: async (cmd) => { if (cmd === 'host_prints') return true; throw new Error('could not write'); } } };
    ok('as does a host_print that fails', (await printOnce()) === 1);
    frame.removeEventListener('load', stub);
    closeReportDialog();
  } catch (e) {
    ok('the suite ran to the end', false, String(e && e.stack || e).slice(0, 300));
  } finally {
    URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; HTMLAnchorElement.prototype.click = realClick;
    if (heldTauri === undefined) delete window.__TAURI__; else window.__TAURI__ = heldTauri;
    try { closeReportDialog(); } catch (e) { /* closed */ }
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
