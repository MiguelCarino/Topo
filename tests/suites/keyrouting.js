// Keys behind a Topo overlay (js/app.js, the window keydown handler). The
// share, report and unlock dialogs, the mode picker and the shortcut list
// cover the map, so no map key may act behind them: Ctrl+Z used to undo a
// rename nobody could see, F refit the map, 1 to 3 switched the library tab,
// / took the focus into the search box, T toggled the trace, and Esc cleared
// the selection while it closed the dialog. What is held here:
//   1. for each overlay, with the focus on nothing: Ctrl+Z, F, 2, / and T do
//      nothing to the map, and Ctrl+Z and Ctrl+Y are stopped (prevented),
//      since native Undo would reach the sidebar field behind the overlay;
//      in the overlay's own passphrase field Ctrl+Z is left to that field;
//   2. Esc closes that overlay only, and the selection stays; the unlock
//      dialog's question is answered with nothing;
//   3. once it is closed, F and Ctrl+Z act on the map again;
//   4. ? closes the shortcut list when it is all that is open;
//   5. the rack view: an arrow on a focused device does not move it while the
//      shortcut list covers the rack, and Esc closes the list.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const shown = (id) => !el(id).classList.contains('hidden');
  const key = (k, extra = {}) => {
      const e = new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra));
      window.dispatchEvent(e);
      return e;
  };
  const keyOn = (target, k, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
  const blur = () => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); };
  const zoomTo = (z) => { state.camera = { x: 0, y: 0, zoom: z }; applyCamera(); };
  const savedView = state.settings.view;
  const savedTab = state.settings.libraryTab;

  const D = (id, x, y, ip) => ({ id, type: 'pc', name: id.toUpperCase(), x, y, interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const lab = () => ({ v: DOC_VERSION, nodes: [D('a', 100, 100, '10.0.0.11/24'), D('b', 300, 100, '10.0.0.12/24')], links: [] });

  // Each overlay, opened as the app opens it, and how it is known to be open.
  let unlockAnswer;
  const overlays = [
      { name: 'the share dialog', open: () => openShareDialog('doc'), isOpen: () => shown('shareDialog') },
      { name: 'the mode picker', open: () => openModePicker(), isOpen: () => shown('modePicker') },
      { name: 'the report dialog', open: () => openReportDialog(), isOpen: () => shown('reportDialog') },
      { name: 'the shortcut list', open: () => toggleShortcutHelp(true), isOpen: () => helpShown() },
      { name: 'the unlock dialog', open: () => { unlockAnswer = askPassphrase(); }, isOpen: () => shown('unlockDialog') }
  ];

  try {
    replaceDocument(lab(), { origin: 'file' });
    showLibraryTab('nodes');

    for (const o of overlays) {
      select(null, null);
      getNode('a').name = 'Renamed'; save();
      o.open();
      blur();
      ok(`${o.name} is open`, o.isOpen() && topoOverlayOpen() && mapKeysBlocked());

      // ---- 1: the map's keys do nothing behind it ----
      const z = key('z', { ctrlKey: true });
      ok(`${o.name}: Ctrl+Z leaves the rename alone`, getNode('a').name === 'Renamed', getNode('a').name);
      ok(`${o.name}: and native Undo is stopped too, so it cannot reach a field behind`, z.defaultPrevented && getNode('a').name === 'Renamed');
      const y = key('y', { ctrlKey: true });
      ok(`${o.name}: so is Ctrl+Y`, y.defaultPrevented && getNode('a').name === 'Renamed');
      const field = { 'the share dialog': 'sharePass', 'the unlock dialog': 'unlockPass' }[o.name];
      if (field && !el(field).closest('.hidden')) {
        el(field).focus();
        const zIn = key('z', { ctrlKey: true });
        ok(`${o.name}: in its passphrase field Ctrl+Z is that field's own undo`, document.activeElement === el(field) && !zIn.defaultPrevented && getNode('a').name === 'Renamed');
        blur();
      }
      zoomTo(2.5);
      key('f');
      ok(`${o.name}: F does not refit the map`, state.camera.zoom === 2.5, String(state.camera.zoom));
      const tab = state.settings.libraryTab;
      key('2');
      ok(`${o.name}: 2 does not switch the library tab`, state.settings.libraryTab === tab, state.settings.libraryTab);
      key('/');
      ok(`${o.name}: / does not go to the search box`, document.activeElement !== el('queryInput'));
      blur();
      const trace = state.settings.traceMode;
      key('t');
      ok(`${o.name}: T does not toggle the trace`, state.settings.traceMode === trace);

      // ---- 2: Esc closes it and keeps the selection ----
      select('a', 'node');
      blur();
      key('Escape');
      if (o.name === 'the unlock dialog') {
        ok('the unlock question is answered with nothing', (await unlockAnswer) === null);
        closeUnlockDialog();   // what openSealedLink does with that answer
      }
      ok(`${o.name}: Esc closes it`, !o.isOpen() && !topoOverlayOpen());
      ok(`${o.name}: and the selection stays`, state.selectedId === 'a' && state.selectedType === 'node', String(state.selectedId));

      // ---- 3: the map's keys are back ----
      blur();
      zoomTo(2.5);
      key('f');
      ok(`${o.name} closed: F fits the map again`, state.camera.zoom !== 2.5);
      const zBack = key('z', { ctrlKey: true });
      ok(`${o.name} closed: Ctrl+Z undoes again`, zBack.defaultPrevented && getNode('a').name === 'A', getNode('a').name);
    }

    // ---- 4: ? closes the list it opened ----
    blur();
    toggleShortcutHelp(true);
    key('?');
    ok('? closes the shortcut list when it is all that is open', !helpShown());
    key('?');
    ok('and opens it again from the map', helpShown());
    key('Escape');
    ok('Esc closes it', !helpShown());

    // ---- 5: the rack view ----
    replaceDocument({ v: DOC_VERSION,
        nodes: [{ id: 'srv', type: 'server', name: 'SRV', x: 0, y: 0, group: 'rk', rackU: 10, rackHeight: 2, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }],
        links: [], groups: [{ id: 'rk', name: 'Rack 1', kind: 'rack', uHeight: 42 }] }, { origin: 'file' });
    setView('rack');
    const box = () => el('rackView').querySelector('.rk-dev:not(.rk-back)[data-node="srv"]');
    ok('the rack view shows the device', rackShown() && !!box());
    box().focus();
    keyOn(box(), '?');
    ok('? on a racked device opens the shortcut list', helpShown());
    keyOn(box(), 'ArrowUp');
    ok('an arrow behind the list does not move the device', getNode('srv').rackU === 10, String(getNode('srv').rackU));
    keyOn(box(), 'Escape');
    ok('Esc closes the list over the rack', !helpShown());
  } catch (e) {
    ok('the suite ran to its end', false, e && e.stack || String(e));
  } finally {
    toggleShortcutHelp(false); closeModePicker(); closeReportDialog(); closeShareDialog(); closeUnlockDialog();
    state.settings.view = savedView; saveSettings(); applyView();
    showLibraryTab(savedTab);
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 0); });
