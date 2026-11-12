// @realtime @touch 360x780
// Fields at 16px on a touch screen (Mobile review M16; css/app.css "Fields a
// finger types into", js/ui.js openAnnotationEditor). iOS Safari zooms the
// page in on any field whose text is under 16px when it takes the focus, and
// does not zoom back out, so a phone that taps the search box or a cell is
// left magnified and off-centre. On the narrowest phone, 360x780, and again at
// 390x844 (window.__viewport, run-cross.mjs), this suite holds:
//  1. every surface with fields (the search box, the drawer's device, switch
//     and cable panels, the rail's tabs, the table's cell editor, each dialog,
//     the rack view) shows them at 16px or more, none past the screen's edge;
//  2. what the bigger text pushed out of its box still fits: a full date and a
//     15-character gateway in the device fields (stacked on a touch screen),
//     wlp1s0 and 255.255.255.255/32 in an interface row, a port's Untagged
//     hint, and an edited table row no taller than a resting one;
//  3. the note editor at a phone's readable zoom (0.7) types at 16px yet
//     covers exactly the card's box, and at zoom 2 is left unscaled;
//  4. last, every field in the whole page computes 16px or more.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(30); };

  const FIELD = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=color]):not([type=file]):not([type=hidden])'
    + ':not([type=button]):not([type=submit]):not([type=reset]):not([type=image]), select, textarea';
  // Shown: laid out at all (the 1px .date-pick-native counts) and not hidden
  // by an ancestor's visibility.
  const shown = (e) => {
    if (!e.getClientRects().length) return false;
    for (let p = e; p && p.nodeType === 1; p = p.parentElement) if (getComputedStyle(p).visibility === 'hidden') return false;
    return true;
  };
  const px = (e) => parseFloat(getComputedStyle(e).fontSize);
  const name = (e) => e.id || (typeof e.className === 'string' && e.className) || e.tagName;
  const small = (list) => list.filter((e) => px(e) < 16).map((e) => name(e) + ' ' + px(e));
  const fits = (e) => !!e && e.scrollWidth <= e.clientWidth;
  const fieldsIn = (root) => (root ? [...root.querySelectorAll(FIELD)] : []).filter(shown);
  const surface = (label, root, min = 1) => {
    const list = fieldsIn(root);
    ok(label + ': has its fields', list.length >= min, list.length);
    ok(label + ': every field 16px or more', !small(list).length, small(list).join(', '));
    const past = list.filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => name(e) + ' ' + e.getBoundingClientRect().right);
    ok(label + ': nothing past the screen\'s right edge', !past.length, past.join(', '));
  };
  // The dialog open now: the last shown .modal in the page.
  const openModal = () => [...document.querySelectorAll('.modal, .rpv')].filter((m) => m.getClientRects().length).pop() || null;
  const dialog = async (label, open, close, min = 1) => {
    try { open(); } catch (e) { ok(label + ': opens', false, String(e)); return; }
    await settle(); await wait(200);
    const m = openModal();
    ok(label + ': is open', !!m);
    if (m) {
      surface(label, m, min);
      ok(label + ': its card does not scroll sideways', m.scrollWidth <= m.clientWidth, json([m.scrollWidth, m.clientWidth]));
    }
    try { close(); } catch (e) { ok(label + ': closes', false, String(e)); }
    await settle(); await wait(150);
  };
  const ws = document.querySelector('.ws');
  const rail = document.querySelector('.topo-rail');
  const drawerOpen = () => ws.classList.contains('drawer-open');
  const savedView = state.settings.view;
  const savedPin = libraryPinned();
  const textW = (e, text) => {
    const cs = getComputedStyle(e);
    const c = document.createElement('canvas').getContext('2d');
    c.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return c.measureText(text).width + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  };

  // The device panel's widest values, set without events so nothing is
  // stored, then checked against their boxes.
  // Selecting nothing shuts the phone's drawer, so each panel opens it again.
  const openDrawer = async (label) => {
    if (!drawerOpen()) { el('handyMenu').click(); await wait(400); await settle(); }
    ok(label + ': the drawer is open', drawerOpen());
  };
  const devicePanel = async (dev, tag) => {
    select(dev.id, 'node');
    await settle();
    await openDrawer('the device panel' + tag);
    rail.querySelectorAll('details').forEach((d) => { d.open = true; });
    await settle();
    el('propInService').value = '2026-05-14'; el('propServiced').value = '2026-05-14';
    el('propGw').value = '192.168.100.254'; el('propDns').value = '192.168.100.254';
    if (!tag) surface('the device panel', rail, 20);
    const cidrs = [...el('ifaceListContainer').querySelectorAll('input')].filter((e) => e.value === '255.255.255.255/32');
    ok('an interface row shows 255.255.255.255/32 whole' + tag, cidrs.length >= 1 && cidrs.every(fits), cidrs.map((e) => e.scrollWidth + '/' + e.clientWidth).join(' '));
    const nm = [...el('ifaceListContainer').querySelectorAll('input')].find((e) => e.value === 'wlp1s0');
    ok('an interface row shows wlp1s0 whole' + tag, fits(nm), nm && json([nm.scrollWidth, nm.clientWidth]));
    ok('the device panel shows a full date in both date fields' + tag, fits(el('propInService')) && fits(el('propServiced')),
      json([el('propInService').scrollWidth, el('propInService').clientWidth]));
    ok('the device panel shows a 15-character gateway and DNS' + tag, fits(el('propGw')) && fits(el('propDns')),
      json([el('propGw').scrollWidth, el('propGw').clientWidth]));
    ok('the rail does not scroll sideways' + tag, rail.scrollWidth <= rail.clientWidth, json([rail.scrollWidth, rail.clientWidth]));
    ok('the page does not scroll sideways' + tag, document.documentElement.scrollWidth <= innerWidth, json([document.documentElement.scrollWidth, innerWidth]));
    // The panel's own render puts the four fields back as the document has them.
    select(null, null); select(dev.id, 'node');
    await settle();
  };
  const rowCheck = async (tag) => {
    setView('table');
    await settle(); await wait(150);
    const tr = document.querySelector('#tableView tbody tr');
    const rest = tr ? tr.getBoundingClientRect().height : 0;
    const editCol = async (label, find, pickEditor) => {
      const row = document.querySelector('#tableView tbody tr');
      const td = row && [...row.querySelectorAll('td[data-col]')].find(find);
      if (!td) { ok(label + tag + ': the cell is there', false); return; }
      startEdit(td);
      await settle();
      const eds = pickEditor(td);
      const h = td.parentElement.getBoundingClientRect().height;
      ok(label + tag + ': the editor types at 16px or more', eds.length > 0 && eds.every((e) => px(e) >= 16), eds.map(px).join(' '));
      ok(label + tag + ': the row is no taller than a resting row', h <= rest + 0.5, json([h, rest]));
      cancelEdit();
      await settle();
    };
    await editCol('the table\'s name editor', (td) => td.dataset.col === 'name', (td) => [...td.querySelectorAll('.tv-in')]);
    if (!tag) {
      await editCol('the table\'s status pick', (td) => td.dataset.col === 'status', (td) => [...td.querySelectorAll('select.tv-in')]);
      await editCol('the table\'s notes editor', (td) => td.dataset.col === 'notes', (td) => [...td.querySelectorAll('textarea.tv-in')]);
      document.querySelector('#tableView .tv-tabs .tabbtn[data-tvtab="cables"]').click();
      await settle(); await wait(150);
      await editCol('the table\'s cable length', (td) => /length/.test(td.dataset.col), (td) => [...td.querySelectorAll('.unit-field select, .unit-field input')]);
      const dv = document.querySelector('#tableView .tv-tabs .tabbtn[data-tvtab="devices"]');
      if (dv) dv.click();
    }
    setView('map');
    await settle();
  };

  try {
    ok('this page is a 360x780 touch screen', navigator.maxTouchPoints > 0 && innerWidth === 360 && matchMedia('(pointer: coarse)').matches,
      json([navigator.maxTouchPoints, innerWidth, matchMedia('(pointer: coarse)').matches]));
    setLibraryPinned(false);
    replaceDocument(cloneData(templatesData.showcase), { origin: 'template' });
    const dev = state.nodes.find((n) => n.type === 'server' || n.type === 'pc');
    ok('the showcase has a server or a PC', !!dev);
    if (!dev) throw new Error('no device');
    dev.interfaces = dev.interfaces || [];
    dev.interfaces.push({ id: 'm16a', name: 'wlp1s0', ip: '255.255.255.255/32' });
    dev.macOpen = true;
    setView('map');
    select(null, null);
    await settle();

    // 2. The search box and its tools.
    const q = el('queryInput');
    q.value = 'type:camera'; q.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(); await wait(100);
    surface('the search box', el('queryBar'));
    ok('the search tools stay on the screen', el('queryTools').getBoundingClientRect().right <= innerWidth + 0.5, el('queryTools').getBoundingClientRect().right);
    const tb = document.querySelector('.topo-topbar');
    ok('the top bar does not scroll sideways', !tb || tb.scrollWidth <= tb.clientWidth, tb && json([tb.scrollWidth, tb.clientWidth]));
    q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    // 3. The drawer, a device.
    await devicePanel(dev, '');

    // 4. The drawer, a switch: each empty VLAN box shows its hint whole.
    const sw = state.nodes.find((n) => n.type === 'switch');
    ok('the showcase has a switch', !!sw);
    if (sw) {
      select(sw.id, 'node');
      await settle();
      await openDrawer('a switch\'s panel');
      rail.querySelectorAll('details').forEach((d) => { d.open = true; });
      await settle();
      surface('a switch\'s panel', rail);
      const vl = [...rail.querySelectorAll('.port-attr-vlan')].filter((e) => shown(e) && !e.value && e.placeholder);
      const cut = vl.filter((e) => textW(e, e.placeholder) > e.clientWidth + 0.5).map((e) => e.placeholder + ' ' + Math.round(textW(e, e.placeholder)) + '/' + e.clientWidth);
      ok('a port\'s VLAN box shows its hint whole', vl.length > 0 && !cut.length, vl.length + ' ' + cut.slice(0, 3).join(', '));
    }

    // 5. The drawer, a cable.
    const ln = state.links.find((l) => !l.wifi && l.medium !== 'wifi');
    ok('the showcase has a cable', !!ln);
    if (ln) {
      select(ln.id, 'link');
      await settle();
      await openDrawer('a cable\'s panel');
      rail.querySelectorAll('details').forEach((d) => { d.open = true; });
      await settle();
      surface('a cable\'s panel', rail);
      const uf = [...rail.querySelectorAll('.unit-field')].find(shown);
      ok('the cable\'s length field stays inside the rail', !!uf && uf.getBoundingClientRect().right <= rail.getBoundingClientRect().right + 0.5,
        uf && json([uf.getBoundingClientRect().right, rail.getBoundingClientRect().right]));
    }

    // 6. The rail's tabs: computed style holds for a hidden editor too.
    await openDrawer('the rail\'s tabs');
    for (const id of ['netTabBtn', 'groupTabBtn', 'wifiTabBtn', 'providerTabBtn']) {
      const b = el(id);
      if (b) b.click();
      await settle();
      const s = small([...rail.querySelectorAll(FIELD)]);
      ok('the rail\'s ' + id + ' tab: every field 16px or more', !s.length, s.join(', '));
    }
    el('configTabBtn').click();
    await settle();
    if (drawerOpen()) { el('handyMenu').click(); await wait(400); await settle(); }
    select(null, null);

    // 7. The table's cell editor.
    await rowCheck('');

    // 8. The dialogs.
    await dialog('Add devices', () => openAddDevices(), () => closeAddDevices(), 10);
    // Settings shows one section tab at a time (D361): each tab with
    // something in it is measured on its own (D362).
    openSettings(); await settle();
    const setKeys = [...document.querySelectorAll('#settingsDialog .set-tab')].filter((x) => !x.hidden).map((x) => x.dataset.tab);
    closeSettings(); await settle();
    ok('Settings: its tabs found', setKeys.length >= 3, setKeys.join());
    // Back-ups and Setup hold only buttons and ticks: no field to measure.
    for (const k of setKeys) await dialog('Settings, ' + k, () => openSettings(k), () => closeSettings(), ['backup', 'setup'].includes(k) ? 0 : 1);
    await dialog('the report', () => openReportDialog(), () => closeReportDialog());
    await dialog('Save search', () => openSearchDialog(), () => closeSearchDialog());
    setView('table'); await settle();
    await dialog('Paste a column', () => openPasteColumn(), () => closePasteColumn());
    await dialog('Columns', () => openColumnsDialog(), () => closeColumnsDialog());
    setView('map'); await settle();
    await dialog('Expected life', () => openLifeDialog(), () => closeLifeDialog(), 5);
    await dialog('Share', () => openShareDialog(), () => closeShareDialog());
    await dialog('the passphrase', () => { askPassphrase(); }, () => abandonUnlock());
    await dialog('Spreadsheet', () => openCsvDialog('import'), () => closeCsvDialog());
    const asks = [
      ['the ask dialog (text)', () => askPrompt('Name?', { value: 'x' })],
      ['the ask dialog (pick)', () => askPromptPick('Name?', { pick: { label: 'Kind', options: [{ id: 'a', label: 'Alpha' }] } })],
      ['the ask dialog (date)', () => askPromptDate('Why?', { date: { label: 'Until' } })]
    ];
    for (const [label, open] of asks) {
      open();
      await settle(); await wait(150);
      surface(label, el('topoAsk'));
      const cancel = document.querySelector('#topoAskFoot button');
      if (cancel) cancel.click();
      await wait(150);
    }
    const rack = state.groups.find((g) => isRackGroup(g));
    ok('the showcase has a rack', !!rack);
    if (rack) {
      openRackView(rack.id);
      await settle(); await wait(150);
      surface('the rack view', document.querySelector('.topo-rack'));
      setView('map');
      await settle();
    }

    // 9. The note editor.
    const note = { id: 'm16n', x: 0, y: 0, text: 'Check this', style: 'note', size: 12, targets: [] };
    state.annotations.push(note);
    state.camera = { x: 60, y: 200, zoom: 0.7 };
    applyCamera(); renderCanvasOnly();
    await settle();
    const card = el('ui-ann-m16n').getBoundingClientRect();
    openAnnotationEditor(note);
    await settle();
    let ed = el('annEditor');
    const eb = ed.getBoundingClientRect();
    ok('the note editor at zoom 0.7 types at 16px or more', px(ed) >= 16, px(ed));
    ok('the note editor covers the card\'s own box', ['left', 'top', 'width', 'height'].every((k) => Math.abs(eb[k] - card[k]) <= 2),
      json([[card.left, card.top, card.width, card.height], [eb.left, eb.top, eb.width, eb.height]]));
    ok('the note editor is drawn down by a transform', ed.style.transform !== '', ed.style.transform);
    ok('the note editor takes the focus', document.activeElement === ed);
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    state.camera = { x: 60, y: 200, zoom: 2 };
    applyCamera(); renderCanvasOnly();
    await settle();
    openAnnotationEditor(note);
    await settle();
    ed = el('annEditor');
    ok('at zoom 2 the note editor types at 24px, unscaled', Math.abs(px(ed) - 24) < 0.01 && ed.style.transform === '', json([px(ed), ed.style.transform]));
    ed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    state.annotations = state.annotations.filter((a) => a.id !== 'm16n');
    state.camera = { x: 0, y: 0, zoom: 1 };
    applyCamera(); renderCanvasOnly();
    await settle();

    // 10. The sweep: every field in the page.
    const all = small([...document.querySelectorAll(FIELD)]);
    ok('every field in the page computes 16px or more', !all.length, all.slice(0, 12).join(', '));

    // 11. Again at 390x844.
    ok('window.__viewport is there (run-cross.mjs)', typeof window.__viewport === 'function');
    if (typeof window.__viewport === 'function') {
      await window.__viewport(390, 844);
      await settle(); await wait(300);
      ok('(390) the page is 390 wide', innerWidth === 390, innerWidth);
      await devicePanel(dev, ' (390)');
      if (drawerOpen()) { el('handyMenu').click(); await wait(400); await settle(); }
      select(null, null);
      await rowCheck(' (390)');
    }
  } catch (e) {
    ok('the suite ran to its end', false, String(e && e.stack || e));
  } finally {
    try {
      if (drawerOpen()) el('handyMenu').click();
      select(null, null);
      setLibraryPinned(savedPin);
      state.settings.view = savedView; saveSettings(); applyView();
    } catch (e) { /* restoring is best effort */ }
    const pre = document.createElement('pre');
    pre.id = 'TESTOUT';
    pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
