window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const key = (k, opts={}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  const gone = (id) => getComputedStyle(document.getElementById(id)).display === 'none';
  const palItem = (t) => document.querySelector(`#nodePalette .palette-item[data-type="${t}"]`);
  const palGone = (t) => getComputedStyle(palItem(t)).display === 'none';
  const palName = (t) => palItem(t).querySelector('span:last-child').textContent;
  const setView = (profile, advanced) => { state.settings.profile = profile; state.settings.advanced = advanced; saveSettings(); applyProfile(); };

  // ---- Default state ----
  ok('there is no header mode toggle — the picker is the one switch', !document.getElementById('profileToggle'));
  ok('a plain visit lands in Advanced with the Simple home profile',
     state.settings.advanced === true && state.settings.profile === 'simple' && !document.body.classList.contains('simple-mode'));

  // ---- Reducing hides the technical UI, not the data ----
  const nodesBefore = JSON.stringify(state.nodes);
  setView('simple', false);
  ok('the reduced view engages', document.body.classList.contains('simple-mode'));
  ok('the setting persists', (JSON.parse(localStorage.getItem('nettopo_settings')) || {}).advanced === false);
  // offsetParent, not computed display: the checkbox hides via its .cs-control-group parent.
  ok('trace controls are hidden', document.getElementById('toggleTrace').offsetParent === null && gone('traceStatus'));
  ok('the Diagnostics tab is hidden', gone('diagTabBtn'));
  ok('the Blocks tab is hidden', getComputedStyle(document.querySelector('.lib-tab[data-tab="blocks"]')).display === 'none');
  ok('the canvas filter is hidden', gone('canvasFilterBox'));
  ok('IP configuration is hidden', gone('nodeNetworkProps'));
  ok('OS / ports are hidden', gone('osPortsRow'));
  ok('name and delete survive', !gone('propName') && !gone('deleteElementBtn'));
  ok('the document is untouched', JSON.stringify(state.nodes) === nodesBefore);
  ok('the Notes field is gone for good (both modes)', !document.getElementById('propNotes'));
  const advItems = document.querySelectorAll('#nodePalette .palette-adv');
  ok('the palette is curated', advItems.length > 0 && [...advItems].every((b) => getComputedStyle(b).display === 'none'));
  // +2: the Text and Note annotation tools share the palette and stay in the reduced view.
  ok('household devices remain', [...document.querySelectorAll('#nodePalette .palette-item:not(.palette-adv)')].length === paletteDefs.filter((d) => d.simple).length + 2);
  const diagBtn = document.getElementById('cnDiagBtn');
  ok('Sys. Status is hidden', !diagBtn || getComputedStyle(diagBtn).display === 'none');
  ok('zone bubbles are off the canvas', getComputedStyle(document.getElementById('layer-zones')).display === 'none');
  const ipTexts = document.querySelectorAll('.node-ip');
  ok('IP labels are off the canvas', ipTexts.length > 0 && getComputedStyle(ipTexts[0]).display === 'none',
     `${ipTexts.length} labels`);

  // ---- Export trims to a reporter's needs ----
  ok('reduced export keeps Copy link and PNG', !gone('copyUrlBtn') && !gone('exportPngBtn'));
  ok('reduced export drops the builder tools', gone('exportJsonBtn') && gone('importFileBtn') && gone('saveTemplateBtn') && gone('exportWebpBtn'));

  // ---- Plain words ----
  ok('Nodes reads Devices', /Devices/.test(document.querySelector('.lib-tab[data-tab="nodes"]').textContent));
  ok('Networks reads Examples', /Examples/.test(document.querySelector('.lib-tab[data-tab="templates"]').textContent));
  ok('Link Material reads Connection', document.getElementById('linkMediumLabel').textContent === 'Connection');
  ok('UTP reads Network cable', document.querySelector('#propMedium option[value="utp"]').textContent === 'Network cable');

  // ---- Shortcuts to hidden UI are dead; the rest still fire ----
  document.activeElement.blur();
  showLibraryTab('nodes');
  key('3');
  ok('3 no longer opens the hidden Blocks tab', !document.getElementById('tabPanel-blocks') || document.getElementById('tabPanel-blocks').classList.contains('hidden'));
  const traceBefore = state.settings.traceMode;
  key('t');
  ok('T no longer toggles trace', state.settings.traceMode === traceBefore);
  key('2');
  ok('2 still opens Examples', !document.getElementById('tabPanel-templates').classList.contains('hidden'));
  key('1');
  const rows = document.querySelectorAll('#shortcutBody .shortcut-row').length;
  const expected = SHORTCUTS.filter((sc) => !sc.simpleHidden).length;
  ok('the cheatsheet drops the hidden keys', rows === expected, `${rows} rows / ${expected} expected`);

  // ---- Advanced restores everything ----
  setView('simple', true);
  ok('Advanced restores the panels', !document.body.classList.contains('simple-mode') && !gone('diagTabBtn') && !gone('nodeNetworkProps'));
  ok('Advanced restores the words', /Nodes/.test(document.querySelector('.lib-tab[data-tab="nodes"]').textContent)
      && document.getElementById('linkMediumLabel').textContent === 'Link Material'
      && document.querySelector('#propMedium option[value="utp"]').textContent === 'UTP (Solid Gray)');
  ok('the cheatsheet is whole again', document.querySelectorAll('#shortcutBody .shortcut-row').length === SHORTCUTS.length);
  ok('Advanced restores the export menu', !gone('exportJsonBtn') && !gone('importFileBtn'));

  // ---- Home profile is sticky: arrive via #imagenology, toggle away and back ----
  save();
  const docHash = window.location.hash;
  const countBefore = state.nodes.length;
  window.history.replaceState(null, '', '#imagenology');
  await load();
  ok('#imagenology selects the home profile and reduces', state.settings.profile === 'imagenology'
      && document.body.classList.contains('simple-mode') && document.body.classList.contains('profile-imagenology'));
  ok('entry never eats an open diagram', state.nodes.length === countBefore, `${state.nodes.length} vs ${countBefore}`);
  ok('the hash carries the document again', window.location.hash !== '#imagenology' && window.location.hash === docHash);
  ok('imagenology still hides IP configuration', gone('nodeNetworkProps'));
  ok('DICOM and Server join the palette', !palGone('dicom') && !palGone('server'));
  ok('IoT and Camera leave it', palGone('iot') && palGone('camera'));
  ok('Load Balancer stays hidden', palGone('loadbalancer'));
  ok('Server reads PACS / Archive', palName('server') === 'PACS / Archive');
  ok('Workstation reads Viewing Station', palName('pc') === 'Viewing Station');
  setView('imagenology', true); // → Advanced
  ok('switching up gives the full view', !document.body.classList.contains('simple-mode') && palName('server') === 'Server');
  setView('imagenology', false); // → back down
  ok('switching back returns to THEIR simple mode', state.settings.profile === 'imagenology'
      && document.body.classList.contains('profile-imagenology') && palName('server') === 'PACS / Archive');

  // ---- Never stranded on a hidden tab ----
  setView('imagenology', true); // Advanced
  document.getElementById('diagTabBtn').click();
  setView('imagenology', false); // reduce again, while Diagnostics is up
  ok('reducing leaves the Diagnostics tab', !document.getElementById('cfgPanel-config').classList.contains('hidden'));

  // ---- Mode picker: "Something missing? Try another mode" ----
  ok('the mode-switch button sits below the palette',
     !!document.getElementById('modeSwitchBtn') && document.getElementById('tabPanel-nodes').contains(document.getElementById('modeSwitchBtn')));
  document.getElementById('modeSwitchBtn').click();
  const pickerOptions = document.querySelectorAll('#modePickerList .mode-option');
  ok('the picker offers Simple, the full editor and Setup', !document.getElementById('modePicker').classList.contains('hidden')
      && pickerOptions.length === 3 && document.getElementById('modePickerTitle').textContent === 'Choose a mode');
  pickerOptions[1].click(); // Full editor
  ok('picking Full switches to Advanced and closes the picker', state.settings.advanced === true
      && document.getElementById('modePicker').classList.contains('hidden') && !document.body.classList.contains('simple-mode'));
  document.getElementById('modeSwitchBtn').click();
  document.querySelector('#modePickerList .mode-option').click(); // Simple
  const purposeOptions = document.querySelectorAll('#modePickerList .mode-option');
  ok('picking Simple asks the purpose', !document.getElementById('modePicker').classList.contains('hidden')
      && document.getElementById('modePickerTitle').textContent === 'What are you documenting?'
      && purposeOptions.length === Object.keys(PROFILES).length
      && /General/.test(purposeOptions[0].textContent));
  purposeOptions[0].click(); // General
  ok('picking a purpose switches into its simple mode', state.settings.profile === 'simple' && !state.settings.advanced
      && document.body.classList.contains('simple-mode') && document.getElementById('modePicker').classList.contains('hidden'));
  document.getElementById('modeSwitchBtn').click();
  const switchOptions = document.querySelectorAll('#modePickerList .mode-option');
  switchOptions[switchOptions.length - 1].click(); // Setup wizard
  ok('picking Setup opens the device grid directly', document.getElementById('modePicker').classList.contains('hidden')
      && !document.getElementById('setupWizard').classList.contains('hidden'));
  closeSetupWizard();

  // ---- Setup wizard: no purpose question, straight to the devices ----
  window.history.replaceState(null, '', '#setup');
  await load();
  ok('#setup goes straight to the device grid', !document.getElementById('setupWizard').classList.contains('hidden')
      && document.getElementById('modePicker').classList.contains('hidden'));
  closeSetupWizard();
  window.history.replaceState(null, '', '#setup-imagenology');
  await load();
  ok('#setup-imagenology opens the grid in the imagenology profile',
     !document.getElementById('setupWizard').classList.contains('hidden') && state.settings.profile === 'imagenology' && !state.settings.advanced);
  const setupRows = document.querySelectorAll('#setupRows .setup-count');
  ok('one universal grid shows every device kind', setupRows.length === SETUP_ITEMS.length);
  ok('every palette node is offered (router is the hub)', paletteDefs.every((d) =>
      d.type === SETUP_HUB.type || SETUP_ITEMS.some((s) => s.type === d.type)));
  ok('the most likely basic devices come first', SETUP_ITEMS[0].type === 'pc'
      && SETUP_ITEMS.findIndex((d) => d.type === 'firewall') > SETUP_ITEMS.findIndex((d) => d.type === 'printer'));
  const tile = document.querySelector('#setupRows .setup-tile');
  ok('the checklist is a grid of device tiles with steppers below', getComputedStyle(document.getElementById('setupRows')).display === 'grid'
      && !!tile.querySelector('svg') && !!tile.querySelector('.setup-dec')
      && tile.querySelector('svg').getBoundingClientRect().top < tile.querySelector('.setup-dec').getBoundingClientRect().top);
  document.querySelectorAll('#setupRows .setup-dec').forEach((b) => { b.click(); b.click(); b.click(); });
  ok('zeroed tiles dim', [...document.querySelectorAll('#setupRows .setup-tile')].every((t) => t.classList.contains('off')));
  document.querySelectorAll('#setupRows .setup-inc').forEach((b) => b.click());
  ok('raising a count un-dims its tile', [...document.querySelectorAll('#setupRows .setup-tile')].every((t) => !t.classList.contains('off')));
  document.querySelector('#setupRows .setup-inc').click(); // one more computer
  const wanted = [...setupRows].reduce((s, el) => s + Number(el.textContent), 0);
  document.getElementById('setupBuildBtn').click();
  ok('the wizard closes on build', document.getElementById('setupWizard').classList.contains('hidden'));
  ok('the network built itself', state.nodes.length === wanted + 1, `${state.nodes.length} nodes for ${wanted} devices + hub`);
  const hub = state.nodes[0];
  ok('everything hangs off the hub', state.links.length === wanted
      && state.links.every((l) => l.source === hub.id || l.target === hub.id));
  ok('the hub router anchors the build', hub.name === 'Router' && hub.type === 'router');
  ok('devices carry friendly numbered names', state.nodes.some((n) => /^Computer \d$/.test(n.name)));
  ok('devices inherited real addresses invisibly', state.nodes.filter((n) => n.id !== hub.id)
      .some((n) => (n.interfaces || []).some((i) => i.ip && i.ip.includes('/'))));
  ok('the build lands in the simple view — no IPs shown', !state.settings.advanced
      && document.body.classList.contains('simple-mode')
      && getComputedStyle(document.querySelector('.node-ip')).display === 'none');
  // …even when the wizard was opened from the full editor via the picker.
  setView('simple', true);
  document.getElementById('modeSwitchBtn').click();
  const opts = document.querySelectorAll('#modePickerList .mode-option');
  opts[opts.length - 1].click(); // Setup wizard
  document.getElementById('setupBuildBtn').click();
  ok('building from full mode still lands in simple', !state.settings.advanced && document.body.classList.contains('simple-mode'));

  // ---- i18n: the reporter path speaks es / pt-BR / ja ----
  state.settings.lang = 'es'; saveSettings(); setLocale('es'); applyLocale();
  ok('Spanish: the mode button translates', document.getElementById('modeSwitchBtn').textContent === '¿Falta algo? Prueba otro modo');
  setView('simple', false);
  ok('Spanish: simple vocabulary translates', /Dispositivos/.test(document.querySelector('.lib-tab[data-tab="nodes"]').textContent)
      && document.getElementById('linkMediumLabel').textContent === 'Conexión');
  document.getElementById('modeSwitchBtn').click();
  ok('Spanish: the picker translates', document.getElementById('modePickerTitle').textContent === 'Elige un modo');
  closeModePicker();
  window.history.replaceState(null, '', '#setup');
  await load();
  ok('Spanish: the wizard tiles translate', document.querySelector('#setupRows .setup-tile span').textContent === 'Computadoras / laptops');
  document.getElementById('setupBuildBtn').click();
  ok('Spanish: built devices carry Spanish names', state.nodes.some((n) => /^Computadora \d$/.test(n.name)));
  state.settings.lang = 'ja'; saveSettings(); setLocale('ja'); applyLocale();
  window.history.replaceState(null, '', '#setup');
  await load();
  document.getElementById('setupBuildBtn').click();
  ok('Japanese: computers are named PC, not コンピューター', state.nodes.some((n) => /^PC \d$/.test(n.name))
      && state.nodes.every((n) => !/コンピュータ/.test(n.name)));
  ok('Japanese: the html lang attribute follows', document.documentElement.lang === 'ja');
  ok('locale resolution maps regions', resolveLocale('es-MX') === 'es' && resolveLocale('pt-BR') === 'pt-BR'
      && resolveLocale('pt-PT') === 'pt-BR' && resolveLocale('ja-JP') === 'ja' && resolveLocale('ru-RU') === 'ru'
      && resolveLocale('fr') === null);
  state.settings.lang = 'ru'; saveSettings(); setLocale('ru'); applyLocale();
  ok('Russian: the reporter path translates', document.getElementById('modeSwitchBtn').textContent === 'Чего-то не хватает? Попробуйте другой режим'
      && t('Computer') === 'Компьютер');
  ok('Advanced stays English on purpose', (setView('simple', true),
      /Nodes/.test(document.querySelector('.lib-tab[data-tab="nodes"]').textContent)));

  // Leave the app the way the next suite expects it.
  delete state.settings.lang; setLocale('en'); applyLocale();
  state.settings.profile = 'simple'; state.settings.advanced = true; saveSettings(); applyProfile();

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 500); });
