// Cross-engine safeguards. These branches only fire on browsers the CI runner
// isn't (old WebKit's canvas, Safari private-mode storage), so the tests drive
// the real functions with stubbed inputs — the logic is what has to be right,
// and it must be right without depending on which engine runs the suite.
window.addEventListener('load', () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  // ---- Image export names the file for what the canvas produced ----
  const c = document.createElement('canvas'); c.width = c.height = 8;
  const png = encodeCanvas(c, 'png');
  ok('a png export is named .png', png.ext === 'png' && png.url.startsWith('data:image/png'), png.ext);
  ok('a jpeg export is named .jpg, not .jpeg', encodeCanvas(c, 'jpeg').ext === 'jpg', encodeCanvas(c, 'jpeg').ext);

  // Old WebKit silently returns a PNG data URL for image/webp. The download must
  // then be named .png, or the user gets a PNG wearing a .webp extension.
  const pngOnly = { toDataURL: (t) => (t === 'image/webp' ? 'data:image/png;base64,AAAA' : `data:${t};base64,AAAA`) };
  ok('a webp request that yields png is named .png (old-WebKit safeguard)', encodeCanvas(pngOnly, 'webp').ext === 'png',
     encodeCanvas(pngOnly, 'webp').ext);
  // Where webp IS supported, it must stay webp.
  const webpOk = { toDataURL: (t) => `data:${t};base64,AAAA` };
  ok('a real webp export keeps .webp', encodeCanvas(webpOk, 'webp').ext === 'webp', encodeCanvas(webpOk, 'webp').ext);

  // ---- Saving a template survives storage that throws (Safari private mode) ----
  ok('a normal template write succeeds', persistUserTemplates({ probe: 1 }) === true);

  const origSet = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('QuotaExceeded / private mode'); };
  let threw = false, res;
  try { res = persistUserTemplates({ probe: 1 }); } catch (e) { threw = true; }
  Storage.prototype.setItem = origSet; // restore BEFORE asserting, so a failure can't wedge later suites

  ok('a throwing setItem is swallowed, not propagated', !threw);
  ok('and reported as a failed write so the caller can warn', res === false);

  // ---- Every SVG label sets an explicit font-family ----
  // The export rasterizes the SVG WITHOUT the page's CSS, so any text left to
  // inherit its font falls back to the UA default (serif) — and each engine's
  // serif differs. A generic family on every <text> keeps exports consistent.
  state.nodes = [normalizeLoadedNode({ id: 'n', type: 'server', name: 'Export Me', x: 0, y: 0,
      interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.2/24' }] })];
  state.links = [];
  select('n', 'node');
  renderCanvasOnly();
  const texts = [...document.querySelectorAll('#networkCanvas text')];
  ok('the canvas rendered label text', texts.length > 0, String(texts.length));
  const bare = texts.filter((t) => !t.getAttribute('font-family'));
  ok('every SVG <text> sets an explicit font-family (export stays sans/mono, not serif)',
     bare.length === 0, bare.map((t) => `"${t.textContent}"`).join(', ') || 'none');

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
});
