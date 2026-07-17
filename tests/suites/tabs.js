window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const key = (k, opts={}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const vis = (id) => !document.getElementById(id).classList.contains('hidden');

  // ---- Library tabs ----
  ok('three tabs exist', document.querySelectorAll('.lib-tab').length === 3);
  showLibraryTab('nodes');
  ok('nodes tab shows the palette', vis('tabPanel-nodes') && !vis('tabPanel-templates') && !vis('tabPanel-blocks'));
  ok('palette still populated', document.querySelectorAll('#nodePalette button').length === paletteDefs.length,
     document.querySelectorAll('#nodePalette button').length + ' buttons');

  showLibraryTab('templates');
  ok('networks tab shows only itself', vis('tabPanel-templates') && !vis('tabPanel-nodes'));
  const tplRows = document.querySelectorAll('#templateList .lib-item');
  ok('every template is listed', tplRows.length === TEMPLATE_META.length, `${tplRows.length} rows / ${TEMPLATE_META.length} meta`);
  ok('no template metadata is orphaned', TEMPLATE_META.every(m => templatesData[m.key]),
     TEMPLATE_META.filter(m => !templatesData[m.key]).map(m => m.key).join(',') || 'all match');
  ok('no template is missing from the menu', Object.keys(templatesData).every(k => TEMPLATE_META.some(m => m.key === k)),
     Object.keys(templatesData).filter(k => !TEMPLATE_META.some(m => m.key === k)).join(',') || 'all listed');

  showLibraryTab('blocks');
  ok('blocks tab lists every block', document.querySelectorAll('#blockList .lib-item').length === SNIPPET_META.length);
  ok('no block metadata is orphaned', SNIPPET_META.every(m => SNIPPETS[m.key]),
     SNIPPET_META.filter(m => !SNIPPETS[m.key]).map(m => m.key).join(',') || 'all match');
  ok('no block is missing from the menu', Object.keys(SNIPPETS).every(k => SNIPPET_META.some(m => m.key === k)),
     Object.keys(SNIPPETS).filter(k => !SNIPPET_META.some(m => m.key === k)).join(',') || 'all listed');

  // The old dropdowns must be gone, not merely hidden.
  ok('toolbar dropdowns removed', !document.getElementById('templateSelect') && !document.getElementById('snippetSelect'));

  // Clicking a block stamps it and returns you to the canvas view.
  state.nodes = []; state.links = [];
  document.querySelector('#blockList .lib-item button').click();
  ok('clicking a block stamps it', state.nodes.length > 0, state.nodes.length + ' nodes');
  ok('stamping returns to the nodes tab', vis('tabPanel-nodes'));

  // ---- Shortcuts ----
  state.settings.traceMode = false; document.getElementById('toggleTrace').checked = false;
  key('t');
  ok('T toggles trace on', state.settings.traceMode === true);
  key('T');
  ok('T (shifted) toggles trace off', state.settings.traceMode === false);

  key('2'); ok('2 opens the networks tab', vis('tabPanel-templates'));
  key('3'); ok('3 opens the blocks tab', vis('tabPanel-blocks'));
  key('1'); ok('1 opens the nodes tab', vis('tabPanel-nodes'));

  state.settings.alertsHidden = false;
  key('a'); ok('A hides alerts', state.settings.alertsHidden === true);
  key('a'); ok('A shows them again', state.settings.alertsHidden === false);

  key('?'); ok('? opens the help panel', vis('shortcutHelp'));
  key('Escape'); ok('Esc closes it', !vis('shortcutHelp'));

  // The ? header button opens the same panel — the help must be reachable by
  // click, not only by a key you have to already know.
  document.getElementById('helpBtn').click();
  ok('the ? header button opens the help panel', vis('shortcutHelp'));
  document.getElementById('shortcutClose').click();

  document.activeElement.blur();
  key('/');
  ok('/ focuses the canvas filter', document.activeElement.id === 'canvasFilter', document.activeElement.id);

  // Typing in a field must not fire shortcuts — the classic bug.
  const filter = document.getElementById('canvasFilter');
  filter.focus();
  const traceBefore = state.settings.traceMode;
  key('t');
  ok('typing "t" in a field does not toggle trace', state.settings.traceMode === traceBefore);
  key('Escape');
  ok('Esc escapes the field', document.activeElement.id !== 'canvasFilter');

  // Browser combos must pass through untouched.
  const before = state.settings.traceMode;
  key('t', { ctrlKey: true });
  ok('Ctrl+T is left to the browser', state.settings.traceMode === before);

  // The cheatsheet is generated from the same table that fires.
  const listed = document.querySelectorAll('#shortcutBody .shortcut-row').length;
  ok('cheatsheet documents every shortcut', listed === SHORTCUTS.length, `${listed} rows / ${SHORTCUTS.length} shortcuts`);

  // The mouse interactions moved out of the Nodes palette and into this one help
  // surface, so they must be here — and gone from the palette.
  const helpText = document.getElementById('shortcutBody').textContent;
  ok('help lists the click / drag / right-click interactions',
     /Click/.test(helpText) && /Drag/.test(helpText) && /Right-click/i.test(helpText));
  ok('the interactions no longer clutter the Nodes palette',
     !/Right Click/i.test(document.getElementById('tabPanel-nodes').textContent));

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 500); });
