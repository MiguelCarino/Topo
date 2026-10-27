// Vector SVG export (plan, "Vector SVG export"; js/app.js canvasSvgMarkup and
// canvasSvgFile), and the image export it shares a builder with.
//   1. Export > SVG image saves the drawing as an .svg named like every other
//      download, in the full editor only (a reduced view keeps PNG), with a
//      label in the page's language;
//   2. the file is a standalone SVG: an XML declaration, the SVG namespace, a
//      size in pixels that matches its viewBox, a background of its own, the
//      site's name as its title, every device and cable on the map, and
//      nothing that points outside the file or runs (no script, no remote
//      href, no foreignObject);
//   3. it is the drawing, not the editor: the ✕ on a selected device is left
//      out, the map's stylesheet class too;
//   4. building it leaves the live map alone. The PNG export used to re-point
//      the live canvas (its transform, size and viewBox), serialize it and put
//      the camera back with a redraw, so a throw in between left the map
//      cropped and zoomed to the export. Now both build from a detached copy:
//      the canvas's attributes are what they were and no redraw happens;
//   5. the PNG still comes out, cropped the same way.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const parse = (text) => new DOMParser().parseFromString(text, 'image/svg+xml');
  try {
    const doc = {
      v: DOC_VERSION,
      nodes: [
        { id: 'r', type: 'router', name: 'Router', x: 100, y: 100, interfaces: [{ id: 'i1', name: 'lan', ip: '10.1.0.1/24' }] },
        { id: 's', type: 'switch', name: 'Switch', x: 300, y: 100, portCount: 8, interfaces: [] },
        { id: 'p', type: 'pc', name: 'Reception & <Front>', x: 300, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.1.0.20/24' }] }
      ],
      links: [
        { id: 'a', source: 'r', target: 's', sourceIface: 'i1', targetIface: 'p1', cable: { label: 'UP-1' } },
        { id: 'b', source: 's', target: 'p', sourceIface: 'p2', targetIface: 'i1' }
      ],
      report: { site: 'Clínica Norte' }
    };
    replaceDocument(doc, { origin: 'file' });
    select('p', 'node');   // the selected device carries the ✕ on the map

    // ---- 1. The menu item ----
    const btn = el('exportSvgBtn');
    ok('Export has an SVG image item, in the menu', !!btn && el('exportMenu').contains(btn));
    ok('it is a full-editor item (data-adv), like WEBP', btn.hasAttribute('data-adv'));
    setLocale('es'); applyLocale();
    ok('its label follows the language', /Imagen SVG/.test(btn.textContent) && /vectorial/.test(btn.textContent), btn.textContent);
    setLocale('ja'); applyLocale();
    ok('in every language', /SVG画像/.test(btn.textContent) && /ベクター/.test(btn.textContent), btn.textContent);
    setLocale('en'); applyLocale();
    ok('and back in English', /SVG image/.test(btn.textContent) && /vector/.test(btn.textContent), btn.textContent);

    const workspace = el('workspace'), canvas = el('networkCanvas');
    const live = () => [workspace.getAttribute('transform'), canvas.getAttribute('width'), canvas.getAttribute('height'),
      canvas.getAttribute('viewBox'), canvas.getAttribute('class')].join('|');
    const liveBefore = live();
    const deleteMarks = () => canvas.querySelectorAll('.node-delete').length;
    const marksBefore = deleteMarks();

    // A click saves a file; the anchor's click is caught rather than followed.
    const realClick = HTMLAnchorElement.prototype.click;
    let saved = null;
    HTMLAnchorElement.prototype.click = function () { saved = { name: this.download, href: this.href }; };
    let redraws = 0;
    const realRender = window.renderCanvasOnly;
    window.renderCanvasOnly = function () { redraws++; return realRender.apply(this, arguments); };
    // The page's CSP keeps fetch() off blob: URLs, so the blob is read where
    // it is made.
    const realBlobUrl = URL.createObjectURL;
    let blob = null;
    URL.createObjectURL = function (b) { blob = b; return realBlobUrl.apply(this, arguments); };
    try { btn.click(); } finally {
      HTMLAnchorElement.prototype.click = realClick; window.renderCanvasOnly = realRender; URL.createObjectURL = realBlobUrl;
    }
    ok('the click saves a file named after the site and the date', !!saved && saved.name === `${docFileStem()}.svg`
      && /^clinica-norte-\d{4}-\d{2}-\d{2}\.svg$/.test(saved.name), saved && saved.name);
    ok('from a blob in the page, nothing uploaded', !!saved && saved.href.startsWith('blob:'));
    ok('typed as SVG', !!blob && /^image\/svg\+xml/.test(blob.type), blob && blob.type);
    const text = blob ? await blob.text() : '';

    // ---- 2. A standalone SVG ----
    ok('it starts with an XML declaration', text.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    const svgDoc = parse(text);
    const root = svgDoc.documentElement;
    ok('it parses as SVG, with no error', root.localName === 'svg' && !svgDoc.querySelector('parsererror'));
    ok('in the SVG namespace', root.namespaceURI === 'http://www.w3.org/2000/svg');
    const vb = (root.getAttribute('viewBox') || '').split(' ').map(Number);
    ok('its size in pixels is its viewBox, 1:1', vb.length === 4 && vb[0] === 0 && vb[1] === 0
      && Number(root.getAttribute('width')) === vb[2] && Number(root.getAttribute('height')) === vb[3], root.getAttribute('viewBox'));
    ok('cropped to the drawing plus padding', vb[2] === 200 + 48 + 180 && vb[3] === 200 + 48 + 42 + 180, vb.join(' '));
    const kids = [...root.children];
    ok('the site name is its title', kids[0] && kids[0].localName === 'title' && kids[0].textContent === 'Clínica Norte',
      kids[0] && kids[0].outerHTML);
    const bg = kids.find((k) => k.localName === 'rect');
    ok('a background of its own, under the drawing', !!bg && bg.getAttribute('fill') === '#f8fafc'
      && Number(bg.getAttribute('width')) === vb[2] && kids.indexOf(bg) < kids.findIndex((k) => k.id === 'workspace'));
    ok('every device and every cable', svgDoc.querySelectorAll('g[id^="ui-node-"]').length === 3
      && svgDoc.querySelectorAll('path[id^="ui-link-"]').length === 2);
    ok('names are text, escaped', [...svgDoc.querySelectorAll('text')].some((t) => t.textContent === 'Reception & <Front>')
      && !/<Front>/.test(text));
    ok('the cable label is in it', [...svgDoc.querySelectorAll('text')].some((t) => t.textContent === 'UP-1'));
    ok('nothing in it runs or reaches out', !svgDoc.querySelector('script, foreignObject')
      && !/(?:href|src)="(?:https?:)?\/\//.test(text) && !/url\((?!#)/.test(text));
    ok('the device glyphs are inline', svgDoc.querySelectorAll('g[id^="ui-node-"] svg path, g[id^="ui-node-"] svg rect, g[id^="ui-node-"] svg circle').length > 0);

    // ---- 3. The drawing, not the editor ----
    ok('the map shows the ✕ on the selected device', marksBefore === 1, String(marksBefore));
    ok('the file does not', svgDoc.querySelectorAll('.node-delete').length === 0);
    ok('nor the map\'s stylesheet class', !root.hasAttribute('class'));

    // ---- 4. The live map is left alone ----
    ok('the live canvas keeps its transform and has no export size', live() === liveBefore, `${liveBefore} -> ${live()}`);
    ok('and the export did not redraw it', redraws === 0, String(redraws));
    ok('the ✕ is still on the map', deleteMarks() === 1);

    // ---- 5. The PNG still comes out ----
    const png = await captureCanvasImage('png', 1);
    ok('the PNG export still works, from the same crop', !!png && png.url.startsWith('data:image/png') && png.width === vb[2] && png.height === vb[3],
      png && `${png.width}x${png.height}`);
    ok('and leaves the live canvas alone too', live() === liveBefore);
    const markup = canvasSvgMarkup(4);
    ok('the image builder scales the size, not the drawing', Number(parse(markup.markup).documentElement.getAttribute('width')) === vb[2] * 4
      && parse(markup.markup).documentElement.getAttribute('viewBox') === vb.join(' '));

    // ---- Nothing to draw ----
    replaceDocument({ v: DOC_VERSION, nodes: [], links: [] }, { origin: 'file' });
    saved = null;
    HTMLAnchorElement.prototype.click = function () { saved = this.download; };
    try { el('exportSvgBtn').click(); } finally { HTMLAnchorElement.prototype.click = realClick; }
    ok('an empty map saves nothing', saved === null && canvasSvgFile() === null);

    // ---- A reduced view keeps PNG only ----
    state.settings.advanced = false; applyProfile();
    ok('a reduced view has no SVG item', getComputedStyle(el('exportSvgBtn')).display === 'none');
    state.settings.advanced = true; applyProfile();
  } catch (e) {
    ok('the suite ran without throwing', false, String(e && (e.stack || e.message) || e));
  }
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 50); });
