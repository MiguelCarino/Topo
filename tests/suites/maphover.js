// What the pointer is over on the map lights up (css/app.css, "What the
// pointer is over"), so it is plain what a click will pick. It is only a
// look:
//   1. the rule reaches every kind of thing a click picks on the map (a
//      device, a cable, a note, a collapsed group's card and its cable),
//      under a mouse only, so a finger's tap never leaves it stuck;
//   2. moving the pointer over them selects nothing, opens no panel and
//      redraws nothing;
//   3. the export carries no stylesheet, so never the highlight.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const savedProfile = state.settings.profile, savedAdvanced = state.settings.advanced;
  try {
    state.settings.advanced = true; applyProfile();
    replaceDocument({
      v: DOC_VERSION,
      nodes: [
        { id: 'r', type: 'router', name: 'Router', x: 100, y: 100, interfaces: [] },
        { id: 's', type: 'switch', name: 'Switch', x: 300, y: 100, portCount: 8, interfaces: [], group: 'g1' },
        { id: 'p', type: 'pc', name: 'Reception', x: 300, y: 300, interfaces: [], group: 'g1' }
      ],
      links: [
        { id: 'a', source: 'r', target: 's' },
        { id: 'b', source: 's', target: 'p' }
      ],
      annotations: [{ id: 'n1', x: 100, y: 10, text: 'Main router', style: 'note', size: 12, targets: [] }],
      groups: [{ id: 'g1', name: 'Closet', kind: 'room' }]
    }, { origin: 'file' });
    select(null);

    // ---- 1. The rule and what it reaches ----
    const rules = [];
    for (const sheet of document.styleSheets) {
      let list; try { list = sheet.cssRules; } catch (_) { continue; }
      for (const r of list) if (r.media && r.conditionText && /hover:\s*hover/.test(r.conditionText)) rules.push(r);
    }
    const hover = rules.find((r) => [...r.cssRules].some((x) => /ui-node-.*:hover/.test(x.selectorText)));
    ok('the highlight is for a mouse only', !!hover && /pointer:\s*fine/.test(hover.conditionText), hover && hover.conditionText);
    // Each :hover selector with the :hover taken off, so a renamed id or
    // layer shows up here rather than as a highlight that silently stopped.
    const lit = (node) => !!node && [...(hover ? hover.cssRules : [])]
      .some((x) => x.style.filter && x.selectorText.split(',').some((s) => node.matches(s.replace(/:hover/g, '').trim())));
    ok('a device lights', lit(el('ui-node-r')));
    ok('a cable lights', lit(el('ui-link-a')));
    ok('a note lights', lit(el('ui-ann-n1')));
    setGroupCollapsed('g1', true);
    ok("a collapsed group's card lights", lit(el('ui-group-g1')));
    ok("a collapsed group's cable lights", lit(document.querySelector('#layer-links > path.grp-edge')));
    setGroupCollapsed('g1', false);
    ok('a device label (not a click target of its own) is not lit', !lit(el('ui-node-r').querySelector('text')));
    // Never the selection's gold (in the Gold theme that is --accent too).
    // Read from the rule: a headless page has no mouse, so the media query
    // that sets it does not apply here.
    const hueRule = [...(hover ? hover.cssRules : [])].find((x) => x.style.getPropertyValue('--map-hover'));
    const hue = hueRule ? hueRule.style.getPropertyValue('--map-hover').trim().toLowerCase() : '';
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toLowerCase();
    ok('the highlight is not the selection colour', !!hue && hue !== '#eab308' && hue !== accent, `${hue} vs ${accent}`);

    // ---- 2. Only a look ----
    let redraws = 0;
    const realRender = window.renderCanvasOnly, realDraw = window.drawCanvas;
    window.renderCanvasOnly = function () { redraws++; return realRender.apply(this, arguments); };
    window.drawCanvas = function () { redraws++; return realDraw.apply(this, arguments); };
    const panelOpen = () => !el('propertiesPane').classList.contains('hidden');
    ok('no panel is open before', !panelOpen());
    for (const id of ['ui-node-r', 'ui-link-a', 'ui-ann-n1']) {
      const target = el(id), box = target.getBoundingClientRect();
      const at = { bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
      target.dispatchEvent(new MouseEvent('mouseover', at));
      target.dispatchEvent(new MouseEvent('mousemove', at));
      window.dispatchEvent(new MouseEvent('mousemove', at));
    }
    await new Promise((r) => setTimeout(r, 60));
    window.renderCanvasOnly = realRender; window.drawCanvas = realDraw;
    ok('hovering selects nothing', state.selection.size === 0 && !state.selectedId, String(state.selection.size));
    ok('hovering opens no panel', !panelOpen());
    ok('hovering redraws nothing', redraws === 0, String(redraws));

    // ---- 3. The export ----
    const svg = canvasSvgMarkup(1).markup;
    ok('the export has no highlight', !/drop-shadow/.test(svg));
  } catch (e) {
    ok('the suite ran without throwing', false, String(e && (e.stack || e.message) || e));
  }
  state.settings.profile = savedProfile; state.settings.advanced = savedAdvanced; applyProfile();
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 50); });
