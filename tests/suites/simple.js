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
  // offsetParent, not computed display: the controls hide with the Diagnostics tab that holds them.
  ok('trace controls are hidden', document.getElementById('toggleTrace').offsetParent === null
     && document.getElementById('traceStatus').offsetParent === null && gone('handyTrace'));
  ok('the Diagnostics tab is hidden', gone('diagTabBtn'));
  ok('the Blocks tab is hidden', getComputedStyle(document.querySelector('.lib-tab[data-tab="blocks"]')).display === 'none');
  ok('the search box is hidden', gone('queryBar'));
  ok('IP configuration is hidden', gone('nodeNetworkProps'));
  ok('OS / ports are hidden', gone('osPortsRow'));
  ok('name and delete survive', !gone('propName') && !gone('deleteElementBtn'));
  ok('the document is untouched', JSON.stringify(state.nodes) === nodesBefore);
  // The full editor has a Notes field again (the field schema made notes an
  // edited field, not only a printed one); the reduced views keep it hidden.
  ok('the Notes field is hidden in the reduced view', gone('notesRow'));
  const advItems = document.querySelectorAll('#nodePalette [data-adv]');
  ok('the palette is curated', advItems.length > 0 && [...advItems].every((b) => getComputedStyle(b).display === 'none'));
  // +2: the Text and Note annotation tools share the palette and stay in the reduced view.
  ok('household devices remain', [...document.querySelectorAll('#nodePalette .palette-item:not([data-adv])')].length === paletteDefs.filter((d) => d.simple).length + 2);
  const diagBtn = document.getElementById('cnDiagBtn');
  ok('Sys. Status is hidden', !diagBtn || getComputedStyle(diagBtn).display === 'none');
  ok('zone bubbles are off the canvas', getComputedStyle(document.getElementById('layer-zones')).display === 'none');
  const ipTexts = document.querySelectorAll('.node-ip');
  ok('IP labels are off the canvas', ipTexts.length > 0 && getComputedStyle(ipTexts[0]).display === 'none',
     `${ipTexts.length} labels`);

  // ---- Export trims to a reporter's needs ----
  ok('reduced export keeps Copy link and PNG', !gone('copyUrlBtn') && !gone('exportPngBtn'));
  ok('reduced export drops the builder tools', gone('exportJsonBtn') && gone('importFileBtn') && gone('saveTemplateBtn') && gone('exportWebpBtn') && gone('exportSvgBtn'));

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
  const addOpen = () => !document.getElementById('addDevices').hidden;
  ok('picking Setup opens the device grid directly', document.getElementById('modePicker').classList.contains('hidden') && addOpen());
  closeAddDevices();

  // ---- Setup (the Add devices intake): no purpose question, straight to the devices ----
  window.history.replaceState(null, '', '#setup');
  await load();
  ok('#setup goes straight to the device grid', addOpen()
      && document.getElementById('modePicker').classList.contains('hidden'));
  ok('#setup keeps the advanced options folded away', !document.getElementById('addMore').open);
  closeAddDevices();
  window.history.replaceState(null, '', '#setup-imagenology');
  await load();
  ok('#setup-imagenology opens the grid in the imagenology profile',
     addOpen() && state.settings.profile === 'imagenology' && !state.settings.advanced);
  const setupRows = document.querySelectorAll('#addRows .add-count');
  ok('one universal grid shows every device kind', setupRows.length === ADD_KINDS.filter((k) => !k.addOnly).length);
  ok('every palette node is offered (router is the hub)', paletteDefs.every((d) =>
      d.type === ADD_HUB.type || ADD_KINDS.some((s) => s.type === d.type && !s.addOnly)));
  ok('the most likely basic devices come first', ADD_KINDS[0].type === 'pc'
      && ADD_KINDS.findIndex((d) => d.type === 'firewall') > ADD_KINDS.findIndex((d) => d.type === 'printer'));
  const tile = document.querySelector('#addRows .setup-tile');
  ok('the checklist is a grid of device tiles with steppers below', getComputedStyle(document.getElementById('addRows')).display === 'grid'
      && !!tile.querySelector('svg') && !!tile.querySelector('.add-dec')
      && tile.querySelector('svg').getBoundingClientRect().top < tile.querySelector('.add-dec').getBoundingClientRect().top);
  document.querySelectorAll('#addRows .add-dec').forEach((b) => { b.click(); b.click(); b.click(); });
  ok('zeroed tiles dim', [...document.querySelectorAll('#addRows .setup-tile')].every((t) => t.classList.contains('off')));
  document.querySelectorAll('#addRows .add-inc').forEach((b) => b.click());
  ok('raising a count un-dims its tile', [...document.querySelectorAll('#addRows .setup-tile')].every((t) => !t.classList.contains('off')));
  // The count is typed now, and the cap of 9 is gone.
  const pcCount = document.querySelector('#addRows .add-count[data-type="pc"]');
  pcCount.value = '12'; pcCount.dispatchEvent(new Event('input'));
  document.querySelector('#addRows .add-inc').click(); // one more computer: 13
  ok('a count is typed and goes past 9', pcCount.value === '13');
  pcCount.value = '5000'; pcCount.dispatchEvent(new Event('change'));
  ok('but not past ADD_MAX', pcCount.value === String(ADD_MAX));
  pcCount.value = '13'; pcCount.dispatchEvent(new Event('change'));
  const wanted = [...setupRows].reduce((s, el) => s + Number(el.value), 0);
  document.getElementById('addApplyBtn').click();
  ok('the dialog closes on build', !addOpen());
  ok('the network built itself', state.nodes.length === wanted + 1, `${state.nodes.length} nodes for ${wanted} devices + hub`);
  const hub = state.nodes[0];
  ok('the hub router anchors the build', hub.name === 'Router' && hub.type === 'router');
  // Switches are not leaves any more: the gear hangs off the router, the hosts off the first switch.
  const firstSwitch = state.nodes.find((n) => n.type === 'switch');
  const parentOf = (n) => { const l = state.links.find((x) => x.target === n.id); return l && l.source; };
  ok('the switches, APs and routers-to-be hang off the router', state.nodes.filter((n) => n !== hub && ADD_INFRA.has(n.type)).every((n) => parentOf(n) === hub.id));
  ok('and the hosts off the first switch', state.nodes.filter((n) => n !== hub && !ADD_INFRA.has(n.type)).every((n) => parentOf(n) === firstSwitch.id));
  ok('every device has its cable', state.links.length === wanted);
  ok('devices carry friendly numbered names', state.nodes.some((n) => /^Computer \d+$/.test(n.name)) && state.nodes.some((n) => n.name === 'Computer 13'));
  ok('devices inherited real addresses invisibly', state.nodes.filter((n) => n.id !== hub.id)
      .some((n) => (n.interfaces || []).some((i) => i.ip && i.ip.includes('/'))));
  ok('no two devices share an address', (() => { const ips = state.nodes.flatMap((n) => (n.interfaces || []).map((i) => i.ip).filter(Boolean)); return new Set(ips).size === ips.length; })());
  ok('the build lands in the simple view — no IPs shown', !state.settings.advanced
      && document.body.classList.contains('simple-mode')
      && getComputedStyle(document.querySelector('.node-ip')).display === 'none');
  // Only '#setup' switches the view: the same intake opened from the full
  // editor (the mode picker, the landing) builds there and stays there.
  setView('simple', true);
  document.getElementById('modeSwitchBtn').click();
  const opts = document.querySelectorAll('#modePickerList .mode-option');
  opts[opts.length - 1].click(); // Setup wizard
  document.getElementById('addApplyBtn').click();
  ok('building from full mode stays in the full editor', state.settings.advanced === true && !document.body.classList.contains('simple-mode')
      && state.nodes.length === 6);
  ok('and names its devices in its own vocabulary', state.nodes.some((n) => n.name === 'Workstation 1') && state.nodes.some((n) => n.name === 'Printer'));
  ok('with no gateway or DNS copied onto them', state.nodes.filter((n) => n.type !== 'router').every((n) => !n.gw && !n.dns));
  ok('the network they are on is declared, with the router as its gateway',
     state.networks.length === 1 && state.networks[0].gateway === getValidIps(state.nodes[0])[0].ip.toString());

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
  ok('Spanish: the tiles translate', document.querySelector('#addRows .setup-tile .st-label').textContent === 'Computadoras / laptops');
  ok('Spanish: the dialog translates', document.getElementById('addTitle').textContent === '¿Qué tienes?'
      && document.querySelector('#addMore summary').textContent === 'Más opciones');
  document.getElementById('addApplyBtn').click();
  ok('Spanish: built devices carry Spanish names', state.nodes.some((n) => /^Computadora \d$/.test(n.name)));
  state.settings.lang = 'ja'; saveSettings(); setLocale('ja'); applyLocale();
  window.history.replaceState(null, '', '#setup');
  await load();
  document.getElementById('addApplyBtn').click();
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
