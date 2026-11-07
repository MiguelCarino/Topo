// @realtime @touch 360x780
// Opening without a keyboard, on a real touch screen (Mobile review M17;
// js/dialog.js focusForTyping). On the narrowest phone, 360x780, through
// window.__touch and window.__key (run-cross.mjs), no dialog or card opens
// with a text field focused, so no keyboard comes up before what opened is
// read; the field still takes the focus from a tap. The suite holds:
//   0. this page is on a touch screen, and focusForTyping holds the keyboard;
//   1. the report focuses inside its dialog, never on a field; a tap on Site
//      focuses it; a hardware keyboard's Esc still closes the dialog;
//   2. a rename prompt shows its text with the focus on a button; a tap on
//      the field focuses it; a tap on Cancel answers null;
//   3. Save search keeps the focus off its fields, and its ✕ does not send
//      the focus into the search box;
//   4. Paste a column keeps the focus off its box;
//   5. the unlock dialog focuses its form, not the passphrase;
//   6. a subnet card's Edit, tapped in the drawer, leaves its name unfocused
//      but scrolled into the rail's visible box;
//   7. no horizontal scroll.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(30); };
  const touch = (type, pts) => window.__touch(type, pts);
  const tap = async (x, y) => { await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchEnd', []); await settle(); await wait(350); };
  const mid = (node) => { const r = node.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const tapEl = async (node) => { node.scrollIntoView({ block: 'nearest' }); await settle(); const p = mid(node); await tap(p.x, p.y); };
  const shown = (node) => !!node && !node.hidden && getComputedStyle(node).display !== 'none';
  const drawerOpen = () => document.querySelector('.ws').classList.contains('drawer-open');
  const active = () => document.activeElement;
  const who = (e) => (e ? (e.id || e.className || e.tagName) : 'none');
  const heldResponder = setDialogResponder(null);
  const savedView = state.settings.view;

  const D = (id, x, ip) => ({ id, type: 'pc', name: 'PC ' + id.toUpperCase(), x, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip }] });
  const doc = { v: DOC_VERSION, nodes: [D('a', 0, '10.0.0.11/24'), D('b', 220, '10.0.0.12/24')], links: [], annotations: [],
    networks: [{ id: 'n_lan', name: 'LAN', cidr: '10.0.0.0/24' }] };

  try {
    // ---- 0 ----
    ok('this page is on a touch screen', navigator.maxTouchPoints > 0 && typeof window.__touch === 'function');
    ok('where focusForTyping holds the keyboard', holdKeyboard() === true);
    replaceDocument(doc, { origin: 'file', docId: 'touch-focus' });
    setView('map');
    await settle();

    // ---- 1. The report ----
    openReportDialog('site');
    await settle();
    ok('the report keeps the focus inside its dialog', el('reportDialog').contains(active()), who(active()));
    ok('and off any field that raises a keyboard', !raisesKeyboard(active()), who(active()));
    await tapEl(el('report-site'));
    ok('a tap on Site still focuses it', active() === el('report-site'), who(active()));
    active().blur();
    await settle();
    await window.__key('Escape');
    await settle();
    ok('a hardware keyboard\'s Esc still closes the report', el('reportDialog').classList.contains('hidden'));
    closeReportDialog();

    // ---- 2. A rename prompt ----
    const p = askPrompt('Name this network:', { value: 'Torre A' });
    await settle();
    const input = el('topoAskInput');
    ok('a prompt shows its field with the text', shown(input) && input.value === 'Torre A', `${input.hidden} ${input.value}`);
    ok('with the focus on one of its buttons', active() && active().tagName === 'BUTTON' && !!active().closest('.topo-ask'), who(active()));
    await tapEl(input);
    ok('a tap on the field focuses it', active() === input, who(active()));
    const cancel = [...document.querySelectorAll('#topoAskFoot button')].find((b) => b.textContent === t('Cancel'));
    if (cancel) await tapEl(cancel);
    ok('a tap on Cancel answers null', (await p) === null);

    // ---- 3. Save search ----
    setQuery('PC');
    await settle();
    openSearchDialog();
    await settle();
    ok('Save search keeps the focus off its fields', !raisesKeyboard(active()) && el('searchDialog').contains(active()), who(active()));
    const x = el('searchDialog').querySelector('.modal-x');
    if (x) await tapEl(x); else closeSearchDialog();
    ok('its ✕ closes it', el('searchDialog').hidden);
    ok('without sending the focus into the search box', active() !== el('queryInput') && !raisesKeyboard(active()), who(active()));
    setQuery('');

    // ---- 4. Paste a column ----
    setView('table');
    await settle();
    openPasteColumn();
    await settle();
    ok('Paste a column keeps the focus off its box', active() !== el('pasteText') && !raisesKeyboard(active()), who(active()));
    closePasteColumn();
    setView('map');
    await settle();

    // ---- 5. Unlock ----
    askPassphrase();
    await settle();
    ok('unlock keeps the focus off the passphrase', active() !== el('unlockPass') && !raisesKeyboard(active()), who(active()));
    ok('and inside its form', el('unlockForm').contains(active()), who(active()));
    abandonUnlock();
    await settle();

    // ---- 6. A card's Edit in the drawer ----
    select(null, null);
    if (!drawerOpen()) { await tapEl(el('handyMenu')); await wait(400); }
    ok('the drawer is open', drawerOpen());
    showConfigTab('networks');
    await settle();
    const card = () => document.querySelector('#networkList .net-card[data-net="n_lan"]');
    ok('the Subnets tab shows the card', !!card());
    if (card()) {
      await tapEl(card().querySelector('[data-act="edit"]'));
      await wait(200);
      const nameField = card().querySelector('[data-field="name"]');
      ok('Edit opens the card\'s fields', !!nameField && shown(nameField));
      ok('without focusing the name', active() !== nameField && !raisesKeyboard(active()), who(active()));
      const rail = document.querySelector('.topo-rail').getBoundingClientRect(), nf = nameField.getBoundingClientRect();
      ok('but with it in the rail\'s visible box', nf.height > 0 && nf.top >= rail.top && nf.bottom <= rail.bottom && nf.left >= rail.left && nf.right <= rail.right,
        json([rail.top, rail.bottom, nf.top, nf.bottom]));
    }
    if (drawerOpen()) { el('handyMenu').click(); await wait(400); }

    // ---- 7. Width ----
    ok('no horizontal scroll', document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth} > ${innerWidth}`);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    state.settings.view = savedView; saveSettings(); applyView();
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
