// Phone keyboards (Mobile review M19; js/ui.js KEYBOARDS and setKeyboard,
// the `keys` of the schema rows in js/model.js, data-keys in index.html, the
// table's cell editor in js/table.js). This run is a desktop window with a
// fine pointer. What is held here:
//   1. the window has a fine pointer, so the desktop checks below are real;
//   2. no profile for an address (code, search) asks for a number pad, and
//      only int and dec do;
//   3. static fields: addresses, ports and dates are code (capitals and
//      corrections off, no inputmode), the search boxes say Search, counts
//      are numeric, a length decimal, a name only has autocorrect off, a note
//      has none of it, and the engineer's name capitalises each word;
//   4. the rail agrees with the schema: each field's data-keys is its row's;
//   5. dynamic fields (interfaces, MACs, ports, PoE, subnet, Wi-Fi, provider
//      and group cards, the bulk panel, the prompt) carry the right
//      attributes, and a prompt never keeps the last prompt's keyboard;
//   6. a sweep: every text field on the page, in the rails of a router, a
//      switch, a cable and a cloud, and in the Columns, saved-search and
//      rack-place dialogs, names a known profile;
//   7. the table's cell editor: its column's keyboard, Next while a cell
//      below takes typing and Done on the last row;
//   8. desktop keys unchanged: Enter keeps the value, moves down and closes
//      the editor, Tab lands on the next cell (a read-only one too), and no
//      → is drawn;
//   9. the touch logic with matchMedia standing in for a coarse pointer:
//      Enter opens the cell below, the → opens the next typeable cell along,
//      a refused value keeps its cell open, the last row's Enter ends it.
//      The real-touch version, with the keyboard and the layout, is
//      tests/suites/touchkeys.js.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const tick = () => wait(20);
  const at = (node, a) => (node ? node.getAttribute(a) : 'MISSING');
  const attrs = (node) => (node ? json(['data-keys', 'inputmode', 'autocapitalize', 'autocorrect', 'spellcheck', 'autocomplete', 'enterkeyhint'].map((a) => node.getAttribute(a))) : 'MISSING');
  // The code profile: nothing a phone would capitalise, correct or pad.
  const isCode = (node) => !!node && node.dataset.keys === 'code' && at(node, 'autocapitalize') === 'off' && at(node, 'autocorrect') === 'off'
    && at(node, 'spellcheck') === 'false' && !node.hasAttribute('inputmode');
  const grid = () => el('tvGrid');
  const rowEl = (key) => [...grid().querySelectorAll('tbody tr[data-row]')].find((r) => r.dataset.row === key) || null;
  const cellEl = (key, col) => { const r = rowEl(key); return r ? [...r.querySelectorAll('td[data-col]')].find((td) => td.dataset.col === col) || null : null; };
  const key = (target, k, extra = {}) => target.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra)));
  const editCell = (rk, col) => { const td = cellEl(rk, col); if (!td) return null; td.focus(); key(td, 'Enter'); return _tv.editor; };
  const steps = () => _undoStack.length;

  // Every field a keyboard types into, outside the shared navbar's own.
  const TEXTY = new Set(['text', 'search', 'number', 'email', 'tel', 'url']);
  const sweep = (where) => {
    const bad = [...document.querySelectorAll('input, textarea')].filter((f) => {
      if (f.closest('#carinoNav, #cnAbout')) return false;
      if (f.readOnly || f.classList.contains('date-pick-native')) return false;
      if (f.tagName === 'INPUT' && !TEXTY.has(f.type)) return false;
      return !KEYBOARDS[f.dataset.keys];
    });
    ok(`${where}: every text field names a keyboard`, !bad.length, bad.map((f) => f.id || f.className || f.outerHTML.slice(0, 60)).join(' | '));
  };

  const PC = (id, name, ip, x, extra) => Object.assign({ id, type: 'pc', name, x, y: 300, os: '', interfaces: [{ id: 'i1', name: 'eth0', ip }] }, extra || {});
  const lab = () => ({ v: DOC_VERSION,
    networks: [{ id: 'net1', cidr: '10.0.0.0/24', name: 'Office', gateway: '10.0.0.1', dns: '10.0.0.53', vlan: 10, dhcp: true }],
    groups: [{ id: 'rk', name: 'Rack A', kind: 'rack', uHeight: 42 }],
    providers: [{ id: 'pv', name: 'Telmex', phone: '800 123 4567', email: 'soporte@telmex.example' }],
    wifi: [{ id: 'wf', ssid: 'Office' }],
    columns: [{ id: 'c1', name: 'Cost', kind: 'number' }],
    nodes: [
      { id: 'r', type: 'router', name: 'R1', x: 300, y: 100, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24', mac: 'AA:BB:CC:DD:EE:01', vlan: 10 }] },
      PC('a', 'PC-A', '10.0.0.10/24', 100), PC('b', 'PC-B', '10.0.0.9/24', 200), PC('c', 'PC-C', '10.0.0.11/24', 900),
      { id: 'ap', type: 'ap', name: 'AP', x: 500, y: 100, interfaces: [{ id: 'i1', name: 'wlan0', ip: '10.0.0.30/24', radio: { standard: 'ax' } }] },
      { id: 'isp', type: 'cloud', name: 'ISP', x: 600, y: 0, interfaces: [] },
      { id: 'sw', type: 'switch', name: 'SW', x: 300, y: 200, portCount: 8, interfaces: [], poeBudget: 120 }
    ], links: [
      { id: 'la', source: 'sw', target: 'a', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'lr', source: 'sw', target: 'r', sourceIface: 'p2', targetIface: 'i1' }
    ] });
  const open = () => {
    replaceDocument(lab(), { origin: 'file', docId: 'keyboards' });
    initHistory();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };
  const savedView = state.settings.view;
  const quiet = setDialogResponder(() => null);
  const mm = window.matchMedia;

  try {
    if (landingIsOpen()) closeLanding();
    open();

    // ---- 1. A fine pointer ----
    ok('this is a fine pointer', !matchMedia('(pointer: coarse)').matches);

    // ---- 2. The profiles ----
    const modes = Object.fromEntries(Object.entries(KEYBOARDS).map(([k, p]) => [k, p.inputmode || '']));
    ok('code and search have no inputmode', !modes.code && !modes.search, json(modes));
    ok('only int and dec use a number pad', Object.entries(modes).filter(([, m]) => m === 'numeric' || m === 'decimal').map(([k]) => k).sort().join() === 'dec,int', json(modes));
    ok('no profile uses the url keyboard', !Object.values(modes).includes('url'));

    // ---- 3. Static fields ----
    ['propGw', 'propDns', 'propPorts', 'propSerial', 'propInService', 'propServiced', 'propCableLabel', 'propCableVia', 'bulkPattern'].forEach((id) => {
      ok(`#${id} is code`, isCode(el(id)), attrs(el(id)));
    });
    ['queryInput', 'rackPlaceFilter'].forEach((id) => {
      ok(`#${id} says Search`, at(el(id), 'enterkeyhint') === 'search' && at(el(id), 'autocapitalize') === 'off', attrs(el(id)));
    });
    ok('#propRackU is numeric', at(el('propRackU'), 'inputmode') === 'numeric', attrs(el('propRackU')));
    // A service interval and a PoE draw also read words ("1 year", "class 2"),
    // which a number pad cannot type.
    ok('#propServiceEvery is code', isCode(el('propServiceEvery')), attrs(el('propServiceEvery')));
    ok('#propLifeYears is numeric', at(el('propLifeYears'), 'inputmode') === 'numeric', attrs(el('propLifeYears')));
    ok('#propCableLength is decimal', at(el('propCableLength'), 'inputmode') === 'decimal', attrs(el('propCableLength')));
    ok('#propPoeDraw is code', isCode(el('propPoeDraw')), attrs(el('propPoeDraw')));
    ok('#propName: autocorrect off, capitals left to the phone', at(el('propName'), 'autocorrect') === 'off' && !el('propName').hasAttribute('autocapitalize'), attrs(el('propName')));
    ok('#propNotes: sentences, corrected', el('propNotes').dataset.keys === 'prose' && !el('propNotes').hasAttribute('autocorrect'), attrs(el('propNotes')));
    ok('#setEngineer capitalises words', at(el('setEngineer'), 'autocapitalize') === 'words', attrs(el('setEngineer')));
    ok('#bulkStart is numeric and says Done', at(el('bulkStart'), 'inputmode') === 'numeric' && at(el('bulkStart'), 'enterkeyhint') === 'done', attrs(el('bulkStart')));
    ok('#sqName keeps its autocomplete off and says Done', at(el('sqName'), 'autocomplete') === 'off' && at(el('sqName'), 'enterkeyhint') === 'done', attrs(el('sqName')));
    ok('an address, a list or a date never gets a number pad',
      ['propGw', 'propDns', 'propPorts', 'propInService', 'propServiced', 'tracePort', 'propCableVia'].every((id) => !el(id).hasAttribute('inputmode')));
    sweep('the page');

    // ---- 4. The rail agrees with the schema ----
    const railRows = [
      ...propertyBindings.map((b) => [b.id, NODE_FIELDS, b.key]),
      ...ASSET_INPUTS.map((b) => [b.id, NODE_FIELDS, b.key]),
      ...CABLE_INPUTS.map((b) => [b.id, CABLE_FIELDS, b.key]),
      ['propPoeDraw', NODE_FIELDS, 'poeDraw'], ['propInService', NODE_FIELDS, 'inService'], ['propServiced', NODE_FIELDS, 'serviced'],
      ['propServiceEvery', NODE_FIELDS, 'serviceEvery'], ['propLifeYears', NODE_FIELDS, 'lifeYears'],
      ['propRackU', NODE_FIELDS, 'rackU'], ['propRackHeight', NODE_FIELDS, 'rackHeight']
    ];
    const off = railRows.filter(([id, fields, k]) => !el(id) || el(id).dataset.keys !== schemaKeys(fields, k));
    ok('each rail field types as its schema row says', !off.length, off.map(([id, f, k]) => `${id}=${el(id) && el(id).dataset.keys} vs ${schemaKeys(f, k)}`).join(' '));

    // ---- 5. Dynamic fields ----
    select('r', 'node');
    await tick();
    const ifName = document.querySelector('#interfaceList .if-name, .if-name');
    const ifIp = document.querySelector('.if-row .if-ip:not(.if-tagged-in)');
    ok('an interface name is code', isCode(ifName), attrs(ifName));
    ok('an interface address is code', isCode(ifIp), attrs(ifIp));
    const macIn = [...document.querySelectorAll('.if-ip')].find((x) => x.placeholder === 'AA:BB:CC:DD:EE:FF');
    if (macIn) ok('a MAC is code', isCode(macIn), attrs(macIn));
    const vlanIn = document.querySelector('.if-vlan-in');
    if (vlanIn) ok('an interface VLAN is numeric', at(vlanIn, 'inputmode') === 'numeric', attrs(vlanIn));
    const tagIn = document.querySelector('.if-tagged-in');
    if (tagIn) ok('an interface\'s tagged list is code', isCode(tagIn), attrs(tagIn));
    sweep('a router');

    select('sw', 'node');
    await tick();
    ok('the port count is numeric', at(el('portCountInput'), 'inputmode') === 'numeric', attrs(el('portCountInput')));
    if (el('portStartInput')) ok('the first port number is numeric', at(el('portStartInput'), 'inputmode') === 'numeric', attrs(el('portStartInput')));
    if (el('portPrefixInput')) ok('the port prefix is code', isCode(el('portPrefixInput')), attrs(el('portPrefixInput')));
    const pv = document.querySelector('.port-attr-vlan');
    ok('a port VLAN is numeric', at(pv, 'inputmode') === 'numeric', attrs(pv));
    const pl = document.querySelector('.port-attr-label');
    ok('a port label is code', isCode(pl), attrs(pl));
    const run = document.querySelector('.port-set-run');
    ok('Set run is code and says Done', isCode(run) && at(run, 'enterkeyhint') === 'done', attrs(run));
    ok('the PoE budget is decimal', at(el('poeBudgetInput'), 'inputmode') === 'decimal', attrs(el('poeBudgetInput')));
    const pt = document.querySelector('.port-attr-tagged');
    if (pt) ok('a port\'s tagged list is code', isCode(pt), attrs(pt));
    sweep('a switch');

    select('la', 'link');
    await tick();
    sweep('a cable');
    select('isp', 'node');
    await tick();
    sweep('a cloud');
    select(null, null);

    showConfigTab('networks');
    _netEditOpen.add('net1');
    renderNetworksPanel(true);
    const nf = (k) => document.querySelector(`[data-net="net1"][data-field="${k}"]`);
    ok('a subnet\'s VLAN is numeric', at(nf('vlan'), 'inputmode') === 'numeric', attrs(nf('vlan')));
    ['gateway', 'dns', 'dhcpFirst'].forEach((k) => ok(`a subnet's ${k} is code`, isCode(nf(k)), attrs(nf(k))));
    ok('a subnet\'s name: no autocorrect, spellcheck still off', at(nf('name'), 'autocorrect') === 'off' && at(nf('name'), 'spellcheck') === 'false' && at(nf('name'), 'autocomplete') === 'off', attrs(nf('name')));
    sweep('the Subnets tab');
    _netEditOpen.delete('net1');

    if (wifiOffered()) {
      showConfigTab('wifi');
      _wifiEditOpen.add('wf');
      renderWifiPanel(true);
      const ssid = document.querySelector('[data-wf="wf"][data-field="ssid"]');
      ok('an SSID is code', isCode(ssid), attrs(ssid));
      sweep('the Wi-Fi tab');
      _wifiEditOpen.delete('wf');
    } else ok('the Wi-Fi tab is offered', false);

    showConfigTab('providers');
    _pvEditOpen.add('pv');
    renderProvidersPanel(true);
    const pf = (k) => document.querySelector(`[data-pv="pv"][data-field="${k}"]`);
    ok('a provider\'s phone is tel', at(pf('phone'), 'inputmode') === 'tel', attrs(pf('phone')));
    ok('a provider\'s email is email', at(pf('email'), 'inputmode') === 'email', attrs(pf('email')));
    ok('a provider\'s contact capitalises words', at(pf('contact'), 'autocapitalize') === 'words', attrs(pf('contact')));
    ok('a provider\'s name keeps spellcheck off', at(pf('name'), 'spellcheck') === 'false', attrs(pf('name')));
    // Support hours are a sentence: spellchecked on a desktop, as before.
    ok('a provider\'s support hours keep spellcheck and their form history off', !pf('hours').hasAttribute('spellcheck') && at(pf('hours'), 'autocomplete') === 'off', attrs(pf('hours')));
    sweep('the Providers tab');
    _pvEditOpen.delete('pv');

    showConfigTab('groups');
    _grpEditOpen.add('rk');
    renderGroupsPanel(true);
    const depth = document.querySelector('[data-grp="rk"][data-field="depthMm"]');
    ok('a rack\'s depth is numeric', at(depth, 'inputmode') === 'numeric', attrs(depth));
    sweep('the Groups tab');
    _grpEditOpen.delete('rk');
    showConfigTab('config');

    selectEntries([{ type: 'node', id: 'a' }, { type: 'node', id: 'b' }]);
    await tick();
    const bgw = el('bulkF-gw');
    const bgwIn = bgw && (bgw.matches('input') ? bgw : bgw.querySelector('input'));
    ok('the bulk gateway is code and says Done', isCode(bgwIn) && at(bgwIn, 'enterkeyhint') === 'done', attrs(bgwIn));
    sweep('the bulk panel on devices');
    selectEntries([{ type: 'link', id: 'la' }, { type: 'link', id: 'lr' }]);
    await tick();
    const blen = el('bulkF-cable.length');
    const blenIn = blen && (blen.matches('input') ? blen : blen.querySelector('input'));
    ok('the bulk length is decimal', at(blenIn, 'inputmode') === 'decimal', attrs(blenIn));
    sweep('the bulk panel on cables');
    select(null, null);

    {
      setDialogResponder(null);
      const input = el('topoAskInput');
      const first = askPrompt('CIDR?', { keys: 'code' });
      await tick();
      ok('a CIDR prompt is code and says Done', isCode(input) && at(input, 'enterkeyhint') === 'done', attrs(input));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await Promise.race([first, wait(1500)]);
      const second = askPrompt('Why?');
      await tick();
      ok('the next prompt keeps none of it', input.dataset.keys === 'prose' && !input.hasAttribute('autocapitalize') && !input.hasAttribute('autocorrect'), attrs(input));
      ok('and its own spellcheck and autocomplete stay off', at(input, 'spellcheck') === 'false' && at(input, 'autocomplete') === 'off', attrs(input));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await Promise.race([second, wait(1500)]);
      setDialogResponder(() => null);
    }

    // ---- 6. Dialogs swept ----
    setView('table');
    showTableTab('devices');
    openColumnsDialog();
    await tick();
    const rename = document.querySelector('#colsDialog .cols-name');
    ok('a custom column\'s name says Done', at(rename, 'data-keys') === 'name' && at(rename, 'enterkeyhint') === 'done', attrs(rename));
    sweep('the Columns dialog');
    closeColumnsDialog();
    if (openSearchDialog() !== false) { await tick(); sweep('the saved-search dialog'); closeSearchDialog(); }
    if (openPlaceDialog({ rackId: 'rk', face: 'front', u: 5, height: 1 })) { await tick(); sweep('the rack-place dialog'); closePlaceDialog(); }
    await tick();

    // ---- 7. The table's cell editor ----
    showTableTab('devices');
    await tick();
    let ed = editCell('n:a', 'gw');
    ok('a gateway cell opens', !!ed && ed.colKey === 'gw');
    if (ed) {
      ok('its editor is code, autocomplete off', isCode(ed.el) && at(ed.el, 'autocomplete') === 'off', attrs(ed.el));
      ok('and says Next, with a gateway below', at(ed.el, 'enterkeyhint') === 'next', attrs(ed.el));
      key(ed.el, 'Escape');
    }
    const lastKey = [...grid().querySelectorAll('tbody tr[data-row]')].map((r) => r.dataset.row).pop();
    ed = editCell(lastKey, 'gw');
    if (ed) { ok('on the last row it says Done', at(ed.el, 'enterkeyhint') === 'done', attrs(ed.el)); key(ed.el, 'Escape'); }
    else ok('the last row\'s gateway opens', false, lastKey);
    ed = editCell('n:a', 'x:c1');
    ok('a number column\'s editor has no number pad', !!ed && ed.el.dataset.keys === 'code' && !ed.el.hasAttribute('inputmode'), ed ? attrs(ed.el) : 'no editor');
    if (ed) key(ed.el, 'Escape');
    ed = editCell('n:a', 'name');
    ok('a name cell is a name', !!ed && ed.el.dataset.keys === 'name' && at(ed.el, 'spellcheck') === 'false', ed ? attrs(ed.el) : 'no editor');
    if (ed) key(ed.el, 'Escape');
    showTableTab('interfaces');
    await tick();
    const ipCell = grid().querySelector('tbody td[data-col="ip"].tv-edit');
    if (ipCell) {
      ipCell.focus(); key(ipCell, 'Enter');
      ok('an interface IP editor has no inputmode', !!_tv.editor && !_tv.editor.el.hasAttribute('inputmode') && _tv.editor.el.dataset.keys === 'code', _tv.editor ? attrs(_tv.editor.el) : 'no editor');
      if (_tv.editor) key(_tv.editor.el, 'Escape');
    } else ok('the Interfaces tab has an IP cell', false);
    const vlanCell = grid().querySelector('tbody td[data-col$="vlan"].tv-edit');
    if (vlanCell) {
      vlanCell.focus(); key(vlanCell, 'Enter');
      ok('an interface VLAN editor is numeric', !!_tv.editor && at(_tv.editor.el, 'inputmode') === 'numeric', _tv.editor ? attrs(_tv.editor.el) : 'no editor');
      if (_tv.editor) key(_tv.editor.el, 'Escape');
    }

    // ---- 8. Desktop keys unchanged ----
    showTableTab('devices');
    await tick();
    let n0 = steps();
    ed = editCell('n:a', 'os');
    ok('no → in a cell with a mouse', !!ed && !grid().querySelector('.tv-next'));
    if (ed) {
      ed.el.value = 'Win 11'; key(ed.el, 'Enter');
      ok('Enter keeps it, one undo step', getNode('a').os === 'Win 11' && steps() === n0 + 1, `${getNode('a').os} ${steps() - n0}`);
      ok('moves down and closes the editor', !_tv.editor && _tv.cursor.row === 'n:b' && _tv.cursor.col === 'os', json(_tv.cursor));
    }
    ed = editCell('n:a', 'name');
    if (ed) {
      key(ed.el, 'Tab');
      ok('Tab moves to the next cell, a read-only one too', !_tv.editor && _tv.cursor.col === 'type', json(_tv.cursor));
    }

    // ---- 9. The touch logic, matchMedia standing in for a finger ----
    window.matchMedia = (q) => (q === '(pointer: coarse)' ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : mm.call(window, q));
    try {
      n0 = steps();
      ed = editCell('n:a', 'os');
      ok('touch: the os cell says Next', !!ed && at(ed.el, 'enterkeyhint') === 'next', ed ? attrs(ed.el) : 'no editor');
      const btn = grid().querySelector('td.tv-editing .tv-next');
      ok('touch: a → in the open cell, named', !!btn && btn.getAttribute('aria-label') === t('Next cell') && btn.type === 'button');
      if (ed) {
        ed.el.value = 'Win 10'; key(ed.el, 'Enter');
        ok('touch: Enter keeps it, one undo step', getNode('a').os === 'Win 10' && steps() === n0 + 1);
        ok('touch: and opens the cell below', !!_tv.editor && _tv.editor.rowKey === 'n:b' && _tv.editor.colKey === 'os' && document.activeElement === _tv.editor.el,
          _tv.editor ? `${_tv.editor.rowKey} ${_tv.editor.colKey}` : 'no editor');
        if (_tv.editor) key(_tv.editor.el, 'Escape');
      }
      // An IME's Enter that confirms a word: Chrome's still composing,
      // WebKit's with keyCode 229 straight after the compositionend. Neither
      // commits or moves; an ordinary Enter after a word (Gboard) does.
      ed = editCell('n:a', 'os');
      if (ed) {
        const n2 = steps();
        ed.el.value = 'Win 7';
        key(ed.el, 'Enter', { isComposing: true });
        ok('touch: an Enter while composing is the IME\'s', _tv.editor === ed && getNode('a').os === 'Win 10' && steps() === n2);
        ed.el.dispatchEvent(new CompositionEvent('compositionend', { data: '7' }));
        key(ed.el, 'Enter', { keyCode: 229 });
        ok('touch: and so is WebKit\'s, keyCode 229 right after the compositionend', _tv.editor === ed && getNode('a').os === 'Win 10' && steps() === n2,
          _tv.editor ? `${_tv.editor.rowKey} ${_tv.editor.colKey}` : 'no editor');
        key(ed.el, 'Enter', { keyCode: 13 });
        ok('touch: an ordinary Enter after a word still keeps it and goes on down', getNode('a').os === 'Win 7' && !!_tv.editor && _tv.editor.rowKey === 'n:b',
          `${getNode('a').os} ${_tv.editor ? _tv.editor.rowKey : 'no editor'}`);
        if (_tv.editor) key(_tv.editor.el, 'Escape');
      }
      ed = editCell('n:a', 'name');
      const next = ed && ed.td.querySelector('.tv-next');
      ok('touch: the name cell has a →', !!next);
      if (next) {
        ed.el.value = 'PC-A1';
        // A script's press moves no focus whatever its handlers do, so what
        // is held is that the press is cancelled, which is what keeps a real
        // finger's press from taking the focus (tests/suites/touchkeys.js
        // holds that end to end).
        const pd = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
        const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        next.dispatchEvent(pd); next.dispatchEvent(md);
        ok('touch: the →\'s press is cancelled, so it never takes the focus', pd.defaultPrevented && md.defaultPrevented && document.activeElement === ed.el);
        next.click();
        ok('touch: the → keeps the name', getNode('a').name === 'PC-A1', getNode('a').name);
        ok('touch: and opens the next typeable cell along, past Type and Interfaces', !!_tv.editor && _tv.editor.rowKey === 'n:a' && _tv.editor.colKey === 'gw' && document.activeElement === _tv.editor.el,
          _tv.editor ? `${_tv.editor.rowKey} ${_tv.editor.colKey}` : 'no editor');
        if (_tv.editor) {
          ok('touch: a gateway is code', isCode(_tv.editor.el), attrs(_tv.editor.el));
          const n1 = steps();
          _tv.editor.el.value = 'not-an-ip'; key(_tv.editor.el, 'Enter');
          ok('touch: a refused value keeps its cell open, marked, no chain', !!_tv.editor && _tv.editor.rowKey === 'n:a' && _tv.editor.colKey === 'gw' && _tv.editor.el.classList.contains('bad') && steps() === n1);
          if (_tv.editor) key(_tv.editor.el, 'Escape');
        }
      }
      // A press on the → that loses the field's focus anyway: the blur keeps
      // the value, and the click still moves on.
      ed = editCell('n:b', 'name');
      const next2 = ed && ed.td.querySelector('.tv-next');
      if (next2) {
        ed.el.value = 'PC-B1';
        next2.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        ed.el.blur();
        next2.click();
        ok('touch: after a blur the → still keeps the name and moves on', getNode('b').name === 'PC-B1' && !!_tv.editor && _tv.editor.rowKey === 'n:b' && _tv.editor.colKey === 'gw',
          `${getNode('b').name} ${_tv.editor ? _tv.editor.rowKey + ' ' + _tv.editor.colKey : 'no editor'}`);
        if (_tv.editor) key(_tv.editor.el, 'Escape');
      } else ok('touch: b\'s name cell has a →', false);
      _tv.pointerDown = false;
      ed = editCell(lastKey, 'os');
      if (ed) {
        ok('touch: the last row says Done', at(ed.el, 'enterkeyhint') === 'done', attrs(ed.el));
        ed.el.value = 'IOS 15'; key(ed.el, 'Enter');
        ok('touch: and its Enter ends the chain', !_tv.editor && getNode(lastKey.slice(2)).os === 'IOS 15');
      }
      // A cell below that is a pick: the chain stops there, nothing opened.
      ed = editCell('n:a', 'os');
      if (ed) {
        const below = moveFrom(ed.td, 'down', true);
        ok('touch: tvTypes says no to a pick or a read-only cell', !tvTypes(cellEl('n:a', 'group')) && !tvTypes(cellEl('n:a', 'type')));
        ok('touch: and yes to the cell below', tvTypes(below));
        key(ed.el, 'Escape');
      }
    } finally { window.matchMedia = mm; }
    ok('the stand-in is gone', !matchMedia('(pointer: coarse)').matches);
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    window.matchMedia = mm;
    try { if (_tv.editor) cancelEdit(true); setView(savedView === 'table' ? 'table' : 'map'); } catch (e) { /* the view is restored as far as it can be */ }
    setDialogResponder(quiet);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
