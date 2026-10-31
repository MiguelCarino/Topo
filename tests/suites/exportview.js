// The exports hold what the person exporting sees, never the editor's
// selection (js/app.js canvasSvgMarkup; restLook, js/ui.js). The image is
// built from a copy of the live canvas, which carries no stylesheet, so:
//   1. a selected device, cable, note or note leader is exported in its
//      resting look, and what only a selection or the link mode draws (the
//      port names of a selected cable, the LINK TARGET hint) is left out,
//      while the map itself stays selected and nothing is redrawn;
//   2. in a reduced view, what the page hides with body.simple-mode
//      [data-adv] (addresses, port names, cable labels) is not in the file,
//      though every device and cable is, cropped the same as in the editor;
//   3. a collapsed group's card, its tooltip and its folded cable lose the
//      selection too.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const parse = (text) => new DOMParser().parseFromString(text, 'image/svg+xml');
  const exported = () => parse(canvasSvgMarkup(1).markup);
  const attrs = (node, keys) => (node ? keys.map((k) => node.getAttribute(k)).join('|') : 'missing');
  const savedProfile = state.settings.profile, savedAdvanced = state.settings.advanced;
  try {
    const site = (withGroup) => ({
      v: DOC_VERSION,
      nodes: [
        { id: 'r', type: 'router', name: 'Router', x: 100, y: 100, interfaces: [{ id: 'i1', name: 'lan', ip: '10.1.0.1/24' }], ...(withGroup ? { group: 'g1' } : {}) },
        { id: 's', type: 'switch', name: 'Switch', x: 300, y: 100, portCount: 8, interfaces: [], ...(withGroup ? { group: 'g1' } : {}) },
        { id: 'p', type: 'pc', name: 'Reception', x: 300, y: 300, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.1.0.20/24' }] }
      ],
      links: [
        { id: 'a', source: 'r', target: 's', sourceIface: 'i1', targetIface: 'p1', cable: { label: 'UP-1' } },
        { id: 'b', source: 's', target: 'p', sourceIface: 'p2', targetIface: 'i1' }
      ],
      annotations: [{ id: 'n1', x: 100, y: 10, text: 'Main router', style: 'note', size: 12, targets: ['r'] }],
      groups: withGroup ? [{ id: 'g1', name: 'Closet', kind: 'room' }] : []
    });

    // ---- 1. The full editor: the selection is the editor's ----
    state.settings.advanced = true; applyProfile();
    replaceDocument(site(false), { origin: 'file' });

    select('r', 'node');
    const liveRect = () => el('ui-node-r') && el('ui-node-r').querySelector(':scope > rect');
    ok('the selected device is drawn selected on the map', attrs(liveRect(), ['stroke']) === '#eab308', attrs(liveRect(), ['stroke']));
    let svg = exported();
    const rRect = () => svg.querySelector('#ui-node-r > rect');
    ok('the export draws it at rest', attrs(rRect(), ['stroke', 'fill', 'stroke-width']) === '#cbd5e1|#ffffff|1.5',
      attrs(rRect(), ['stroke', 'fill', 'stroke-width']));
    ok('and carries no bookkeeping of it', !svg.querySelector('[data-rest], [data-sel-only]'));
    const vbFull = svg.documentElement.getAttribute('viewBox');

    select('a', 'link');
    ok('the selected cable shows its port names on the map', el('networkCanvas').querySelectorAll('.port-label').length > 0);
    svg = exported();
    ok('the export has none of them', svg.querySelectorAll('.port-label').length === 0, String(svg.querySelectorAll('.port-label').length));
    ok('and the cable in its own colour and width', attrs(svg.querySelector('#ui-link-a'), ['stroke', 'stroke-width']) === '#94a3b8|2',
      attrs(svg.querySelector('#ui-link-a'), ['stroke', 'stroke-width']));
    const text = new XMLSerializer().serializeToString(svg);
    ok('the full editor still exports addresses and the cable label', text.includes('10.1.0.1/24') && text.includes('UP-1'));

    select('n1', 'annotation');
    svg = exported();
    const annRect = svg.querySelector('#ui-ann-n1 > rect');
    ok('a selected note exports at rest', attrs(annRect, ['stroke', 'stroke-width']) === '#eab308|1', attrs(annRect, ['stroke', 'stroke-width']));
    select('nl:n1:r', 'notelink');
    ok('a selected leader is drawn selected on the map', attrs(el('ui-annlink-n1-r'), ['stroke-width']) === '2.5', attrs(el('ui-annlink-n1-r'), ['stroke-width']));
    svg = exported();
    const leader = svg.querySelector('#ui-annlink-n1-r');
    ok('and exports at rest', attrs(leader, ['stroke-width', 'opacity']) === '1.5|0.85', attrs(leader, ['stroke-width', 'opacity']));

    // The live map is left as it was, with no redraw.
    select('r', 'node');
    let redraws = 0;
    const realRender = window.renderCanvasOnly;
    window.renderCanvasOnly = function () { redraws++; return realRender.apply(this, arguments); };
    let png = null;
    try { canvasSvgMarkup(1); png = await captureCanvasImage('png', 1); canvasSvgFile(); } finally { window.renderCanvasOnly = realRender; }
    ok('the exports did not redraw the map', redraws === 0, String(redraws));
    ok('the map is still selected, its ✕ still there', attrs(liveRect(), ['stroke']) === '#eab308'
      && el('networkCanvas').querySelectorAll('.node-delete').length === 1);
    const pngFull = png;

    // The link mode is the editor's too.
    state.linkSourceId = 'r'; renderCanvasOnly();
    ok('the link mode is drawn on the map', /LINK TARGET/.test(el('ui-node-r').textContent) && attrs(liveRect(), ['stroke']) === '#ca8a04');
    svg = exported();
    ok('the export has no hint of it', !/LINK TARGET/.test(svg.documentElement.textContent) && attrs(rRect(), ['stroke']) !== '#ca8a04',
      attrs(rRect(), ['stroke']));
    state.linkSourceId = null; renderCanvasOnly();

    // ---- 2. A reduced view: what it hides, the file leaves out ----
    state.settings.profile = 'simple'; state.settings.advanced = false; applyProfile();
    ok('the reduced view is on', document.body.classList.contains('simple-mode'));
    select('a', 'link');
    svg = exported();
    const reduced = new XMLSerializer().serializeToString(svg);
    ok('no full-editor detail in the export', !svg.querySelector('[data-adv]'));
    ok('no address, no cable label, no port name', !/10\.1\.0\./.test(reduced) && !reduced.includes('UP-1') && !svg.querySelector('.port-label'));
    ok('every device and cable is still there', svg.querySelectorAll('g[id^="ui-node-"]').length === 3
      && svg.querySelectorAll('path[id^="ui-link-"]').length === 2);
    ok('cropped the same as in the editor', svg.documentElement.getAttribute('viewBox') === vbFull, `${vbFull} / ${svg.documentElement.getAttribute('viewBox')}`);
    png = await captureCanvasImage('png', 1);
    ok('the PNG is the same size', !!png && !!pngFull && png.width === pngFull.width && png.height === pngFull.height,
      png && pngFull && `${png.width}x${png.height} / ${pngFull.width}x${pngFull.height}`);
    state.settings.profile = savedProfile; state.settings.advanced = true; applyProfile();

    // ---- 3. A collapsed group ----
    replaceDocument(site(true), { origin: 'file', docId: 'exportview-doc' });
    setGroupCollapsed('g1', true);
    const card = (root) => root.querySelector('#ui-group-g1 > rect:not(.grp-node-hit):nth-of-type(2)');
    select('r', 'node');   // some of it: the card is picked
    ok('a picked group card is dashed on the map', attrs(card(document), ['stroke', 'stroke-dasharray']) === '#eab308|5 3',
      attrs(card(document), ['stroke', 'stroke-dasharray']));
    svg = exported();
    ok('the export draws it at rest', !!card(svg) && card(svg).getAttribute('stroke') !== '#eab308' && card(svg).getAttribute('stroke-dasharray') !== '5 3',
      attrs(card(svg), ['stroke', 'stroke-dasharray']));
    // Its tooltip names the selection on the map, and not in the file.
    const tipOf = (root) => { const t = root.querySelector('#ui-group-g1 > title'); return t ? t.textContent : 'missing'; };
    ok('the card\'s tooltip says one of them is selected', /1 of them is selected/.test(tipOf(document)), tipOf(document));
    ok('the exported tooltip does not', !/selected/.test(tipOf(svg)) && /Click to expand/.test(tipOf(svg)) && !svg.querySelector('[data-rest-text]'), tipOf(svg));
    ok('and the map\'s tooltip still does', /1 of them is selected/.test(tipOf(document)));
    setSelectionEntries([{ type: 'node', id: 'r' }, { type: 'node', id: 's' }]); renderCanvasOnly();
    ok('a selected group card is drawn selected on the map', attrs(card(document), ['stroke']) === '#eab308');
    svg = exported();
    ok('the export draws it at rest too', attrs(card(svg), ['stroke', 'stroke-width']) === '#64748b|1.5', attrs(card(svg), ['stroke', 'stroke-width']));
    select('b', 'link');
    const edge = (root) => root.querySelector('.grp-edge');
    ok('a selected folded cable is drawn selected on the map', attrs(edge(document), ['stroke']) === '#eab308');
    svg = exported();
    ok('the export draws it at rest', attrs(edge(svg), ['stroke', 'stroke-width']) === '#94a3b8|2', attrs(edge(svg), ['stroke', 'stroke-width']));
    setGroupCollapsed('g1', false);
    select(null);
  } catch (e) {
    ok('the suite ran without throwing', false, String(e && (e.stack || e.message) || e));
  }
  state.settings.profile = savedProfile; state.settings.advanced = savedAdvanced; applyProfile();
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 50); });
