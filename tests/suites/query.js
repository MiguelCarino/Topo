// The search box (plan 3.3, js/query.js), which replaced "Filter canvas".
// What is held here:
//   1. the words: plain text over the schema's fields, the prefixes (name:,
//      type:, ip: as an address, a network or a start, mac: by hex or vendor,
//      vlan:, switch:, has:), quotes, a leading - to leave out, and words it
//      does not understand (loc: before the asset fields exist, vlan:abc)
//      reported and matching nothing rather than everything;
//   2. no reader throws on an interface whose address is not a string;
//   3. the map: what does not match is dimmed by a class, on every redraw (an
//      edit, a click, undo), never by an inline style an export would carry;
//      a cable stays lit by its own match or an end's; the count;
//   4. Zoom to matches and Select matches (devices, or cables on the Cables
//      tab) through the real buttons, and Enter in the box;
//   5. the table: every tab narrows to the matching rows, a device's folded
//      interfaces stay with it, the count and the empty line say so; a tick
//      the search hides is kept and comes back when it is cleared;
//   5b. the top row, however it wraps, never covers the findings panel or
//      the table's tabs (its height is measured, not guessed per width);
//   6. Esc empties the box first and leaves it second; a reduced view has no
//      box and dims nothing; the query is never part of the document;
//   7. its sentences are in every locale.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const dimmed = (id) => el(`ui-node-${id}`).classList.contains('q-dim');
  const linkDim = (id) => el(`ui-link-${id}`).classList.contains('q-dim');
  const lit = () => state.nodes.filter((n) => !dimmed(n.id)).map((n) => n.id).sort().join(',');
  const type = (text) => { const i = el('queryInput'); i.value = text; i.dispatchEvent(new Event('input', { bubbles: true })); };
  const matches = (text) => { const q = parseQuery(text); return state.nodes.filter((n) => queryMatch(q, 'node', n)).map((n) => n.id).sort().join(','); };
  const tableKeys = () => [...el('tvGrid').querySelectorAll('tbody tr[data-row]')].map((r) => r.dataset.row);

  const D = (id, t, name, x, y, ifaces, extra) => Object.assign({ id, type: t, name, x, y, interfaces: ifaces }, extra || {});
  const I = (id, ip, mac) => Object.assign({ id, name: id, ip }, mac ? { mac } : {});
  const lab = () => ({ v: DOC_VERSION,
    nodes: [
      D('r', 'router', 'Edge Router', 100, 100, [I('i1', '10.0.0.1/24'), I('i2', '10.10.30.1/24')]),
      D('sw', 'switch', 'Core SW', 300, 100, [], { portCount: 8 }),
      D('sw2', 'switch', 'Desk SW', 300, 400, [], { portCount: 8 }),
      D('c1', 'camera', 'CAM-1', 200, 250, [I('i1', '10.10.30.11/24', 'AA:BB:CC:00:00:01')]),
      D('c2', 'camera', 'CAM-2', 400, 250, [I('i1', '10.10.30.12/24', '00-1A-2B-3C-4D-5E')]),
      D('pc', 'pc', 'Reception', 500, 400, [I('i1', '10.0.0.50/24')], { notes: 'front desk, ticket 4471' }),
      // The same address as the PC: a duplicate-IP finding on both.
      D('dup', 'printer', 'Printer', 600, 400, [I('i1', '10.0.0.50/24')])
    ],
    links: [
      { id: 'l1', source: 'sw', target: 'c1', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'l2', source: 'sw', target: 'c2', sourceIface: 'p2', targetIface: 'i1', medium: 'fiber' },
      { id: 'l3', source: 'sw', target: 'r', sourceIface: 'p3', targetIface: 'i2' },
      { id: 'l4', source: 'sw2', target: 'pc', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'l5', source: 'sw2', target: 'r', sourceIface: 'p2', targetIface: 'i1' }
    ],
    networks: [
      { id: 'n10', cidr: '10.0.0.0/24', name: 'Office', vlan: 10 },
      { id: 'n30', cidr: '10.10.30.0/24', name: 'Cameras', vlan: 30, purpose: 'CCTV' }
    ] });

  try {
    setView('map');
    replaceDocument(lab(), { origin: 'file' });
    type('');

    // ---- 1: the words ----
    ok('plain text matches a name', matches('cam-') === 'c1,c2');
    ok('plain text matches any schema field (the notes)', matches('ticket') === 'pc');
    ok('plain text matches a type by its name', matches('workstation') === 'pc');
    ok('plain text matches an address', matches('10.10.30.1') === 'c1,c2,r', matches('10.10.30.1'));
    ok('a MAC fragment matches whatever separators it was stored with', matches('1a:2b:3c') === 'c2' && matches('aabbcc') === 'c1', `${matches('1a:2b:3c')} | ${matches('aabbcc')}`);
    ok('words are ANDed', matches('cam 12') === 'c2');
    ok('name:', matches('name:reception') === 'pc');
    ok('type: by key', matches('type:camera') === 'c1,c2');
    ok('type: by name', matches('type:workst') === 'pc');
    ok('ip: a network is containment', matches('ip:10.10.30.0/24') === 'c1,c2,r');
    ok('ip: a wider network holds the narrower', matches('ip:10.0.0.0/8') === 'c1,c2,dup,pc,r');
    ok('ip: an address is exact', matches('ip:10.10.30.1') === 'r' && matches('ip:10.0.0.50') === 'dup,pc');
    ok('ip: the start of one, as typed', matches('ip:10.10.') === 'c1,c2,r');
    ok('mac: by hex, separators ignored', matches('mac:00-00-01') === 'c1' && matches('mac:aa.bb') === 'c1');
    ok('vlan: the declared network the address is on', matches('vlan:30') === 'c1,c2,r' && matches('vlan:10') === 'dup,pc,r');
    ok('switch: devices cabled into it, and the switch', matches('switch:core') === 'c1,c2,r,sw', matches('switch:core'));
    ok('has:finding', matches('has:finding').split(',').includes('pc') && matches('has:finding').split(',').includes('dup'), matches('has:finding'));
    ok('has:mac and has:cable', matches('has:mac') === 'c1,c2' && matches('-has:cable') === 'dup');
    ok('a leading - leaves out', matches('type:camera -cam-2') === 'c1');
    ok('quotes keep words together', matches('"front desk"') === 'pc' && matches('"desk sw"') === 'sw2' && matches('name:"edge router"') === 'r');
    ok('a prefix still being typed is no term yet', matches('type:') === matches('') && matches('') === 'c1,c2,dup,pc,r,sw,sw2');
    const bad = parseQuery('vlan:abc lco:x ip:10.0.0.0/99 has:nothing');
    ok('words it does not understand are reported', bad.errors.join(' ') === 'vlan:abc lco:x ip:10.0.0.0/99 has:nothing', bad.errors.join(' '));
    ok('and a query with one matches nothing, not everything', matches('cam vlan:abc') === '');
    const assetFields = NODE_FIELDS.some((f) => f.key === 'location');
    ok('loc: is understood only once the asset fields exist', assetFields ? !parseQuery('loc:rack').errors.length : parseQuery('loc:rack').errors.length === 1);
    ok('a hex-only "prefix" is a MAC fragment, not a filter', !parseQuery('aa:bb').errors.length && !parseQuery('fe80::1').errors.length);

    // ---- 2: no throw on a non-string address ----
    let threw = '';
    try {
      getNode('dup').interfaces[0].ip = 42;
      getNode('c2').interfaces.push({ id: 'i9', name: 'odd' });
      ['ip:10', 'ip:10.0.0.0/24', '42', 'has:ip', 'vlan:10', 'mac:aa', 'odd'].forEach((q) => { type(q); renderCanvasOnly(); });
      setView('table'); showTableTab('interfaces'); type('ip:10.0.0.0/8'); showTableTab('devices'); setView('map');
    } catch (e) { threw = e.message; }
    ok('an interface with a number for an address, or none, throws nowhere', !threw, threw);
    replaceDocument(lab(), { origin: 'file' });

    // ---- 3: the map ----
    type('type:camera');
    ok('non-matches are dimmed', lit() === 'c1,c2', lit());
    ok('by a class, never an inline style an export would carry', !el('ui-node-pc').getAttribute('style') && !el('ui-node-pc').getAttribute('opacity'));
    ok('a cable with a matching end stays lit, one with none is dimmed', !linkDim('l1') && !linkDim('l2') && linkDim('l4') && linkDim('l5'));
    ok('the count says how many', el('queryCount').textContent === 'Devices: 2 of 7', el('queryCount').textContent);
    ok('the bar shows its tools while a search is on', el('queryBar').classList.contains('q-on') && getComputedStyle(el('querySelectBtn')).display !== 'none');
    renderCanvasOnly();
    ok('a redraw keeps it', lit() === 'c1,c2');
    select('pc', 'node');
    ok('a click elsewhere keeps it', lit() === 'c1,c2' && dimmed('pc'));
    batch(() => { getNode('pc').name = 'Reception desk'; save(); renderCanvasOnly(); });
    ok('an edit keeps it', lit() === 'c1,c2');
    undo();
    ok('undo keeps it', lit() === 'c1,c2' && getNode('pc').name === 'Reception');
    type('fiber');
    ok('a cable matching on its own (its medium) stays lit', !linkDim('l2') && linkDim('l1'));
    type('');
    ok('an empty box dims nothing', lit() === 'c1,c2,dup,pc,r,sw,sw2' && !el('queryBar').classList.contains('q-on') && el('queryCount').textContent === '');

    // ---- 4: Zoom to matches, Select matches, Enter ----
    state.camera = { x: 0, y: 0, zoom: 0.3 }; applyCamera();
    type('cam-1');
    el('queryZoomBtn').click();
    const rect = el('networkCanvas').getBoundingClientRect();
    const c1 = getNode('c1'), sx = state.camera.x + c1.x * state.camera.zoom, sy = state.camera.y + c1.y * state.camera.zoom;
    ok('Zoom to matches frames them', Math.abs(sx - rect.width / 2) < 2 && Math.abs(sy - rect.height / 2) < 60 && state.camera.zoom > 1, `${sx},${sy} zoom ${state.camera.zoom}`);
    type('type:camera');
    state.camera = { x: 0, y: 0, zoom: 0.3 }; applyCamera();
    el('queryInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    ok('so does Enter in the box', state.camera.zoom > 0.3, String(state.camera.zoom));
    el('querySelectBtn').click();
    ok('Select matches feeds the selection set', selectedOf('node').sort().join(',') === 'c1,c2' && !selectedOf('link').length && !el('multiSelectionPane').classList.contains('hidden'));
    type('vlan:abc');
    ok('a word it does not understand: said under the box, nothing matches', !el('queryError').classList.contains('hidden') && /vlan:abc/.test(el('queryError').textContent)
       && el('queryInput').classList.contains('bad') && lit() === '' && el('querySelectBtn').disabled && el('queryZoomBtn').disabled);
    type('');
    ok('and it goes when the word does', el('queryError').classList.contains('hidden') && !el('queryInput').classList.contains('bad'));
    select(null, null);

    // ---- 5: the table ----
    type('type:camera');
    setView('table');
    showTableTab('devices');
    ok('the table narrows to the matches', tableKeys().join(',') === 'n:c1,n:c2', tableKeys().join(','));
    ok('the count counts rows there', el('queryCount').textContent === 'Rows: 2 of 7', el('queryCount').textContent);
    ok('Zoom to matches is a map button', el('queryZoomBtn').classList.contains('hidden'));
    toggleExpand('c1');
    ok('a device\'s interfaces folded open stay with it', tableKeys().join(',') === 'n:c1,d:c1:i1,n:c2', tableKeys().join(','));
    toggleExpand('c1');
    showTableTab('interfaces');
    type('ip:10.10.30.0/24');
    ok('Interfaces: an interface by its own address, not its device\'s other one', tableKeys().join(',') === 'i:r:i2,i:c1:i1,i:c2:i1', tableKeys().join(','));
    showTableTab('cables');
    type('type:camera');
    ok('Cables: a cable by either end', tableKeys().join(',') === 'l:l1,l:l2', tableKeys().join(','));
    el('querySelectBtn').click();
    ok('Select matches on the Cables tab takes the cables', selectedOf('link').sort().join(',') === 'l1,l2' && !selectedOf('node').length);
    showTableTab('subnets');
    type('vlan:30');
    ok('Subnets: by its own fields', tableKeys().join(',') === 's:10.10.30.0/24', tableKeys().join(','));
    type('reception');
    ok('or by a device on it', tableKeys().join(',') === 's:10.0.0.0/24', tableKeys().join(','));
    type('nothing-like-this');
    ok('nothing left: the empty line says the search did it', !el('tvEmpty').classList.contains('hidden') && el('tvEmpty').textContent === 'No rows match the search.');
    type('');
    ok('an empty box gives every row back', tableKeys().length === 2 && el('tvEmpty').classList.contains('hidden'));
    // A tick the search hides is kept, as a selected device is, and comes
    // back with the row; drawing another tab does not drop this one's.
    const ticks = (tab) => [..._tv.checked[tab]].sort().join(',');
    checkRows(_tv.rows.filter((r) => !r.sub), true);
    type('vlan:30');
    ok('a search shows only its ticked rows', tableKeys().join(',') === 's:10.10.30.0/24' && ticks('subnets') === 's:10.0.0.0/24,s:10.10.30.0/24', ticks('subnets'));
    type('');
    ok('and clearing it gives the hidden ticks back', ticks('subnets') === 's:10.0.0.0/24,s:10.10.30.0/24', ticks('subnets'));
    showTableTab('interfaces');
    checkRows(_tv.rows.filter((r) => !r.sub), true);
    type('router');
    type('');
    ok('Interfaces: the same', _tv.checked.interfaces.size === _tv.rows.filter((r) => !r.sub).length, String(_tv.checked.interfaces.size));
    showTableTab('subnets');
    ok('another tab drawn leaves this tab\'s ticks alone', ticks('subnets') === 's:10.0.0.0/24,s:10.10.30.0/24', ticks('subnets'));
    checkRows(_tv.rows.filter((r) => !r.sub), false);
    showTableTab('interfaces'); checkRows(_tv.rows.filter((r) => !r.sub), false); showTableTab('subnets');
    showTableTab('devices');
    setView('map');
    select(null, null);

    // ---- 5b: the top row never covers the findings panel or the table ----
    // Its height is measured (--topbar-h), so it holds however the row wraps:
    // here a search with a "not understood" line, then a pane squeezed until
    // the tools card drops under the box (a phone, or Spanish at 960px).
    // No frames to wait for under the runner's virtual clock: updateQueryBar
    // measures the row itself. A squeeze outside it is measured by hand.
    const frames = async () => syncTopbarHeight();
    const bar = document.querySelector('.topo-topbar');
    const below = (node) => node.getBoundingClientRect().top >= bar.getBoundingClientRect().bottom - 0.5;
    // The findings list is a rail tab now (p2-report); what floats over the
    // map is the pill that counts them.
    const findings = () => [el('conflictPill')].find((n) => n && n.offsetParent);
    // The pill eases to its new place (transition: 0.15s), which the
    // virtual clock never lets finish; where it lands is what is asked.
    el('conflictPill').style.transition = 'none';
    for (const squeeze of ['', '65%']) {
      bar.style.right = squeeze;
      type('has:finding vlan:abc');
      setView('map'); await frames();
      const f = findings();
      ok(`map${squeeze ? ', squeezed' : ''}: the findings pill starts below the top row`, !!f && below(f),
        f ? f.getBoundingClientRect().top + ' < ' + bar.getBoundingClientRect().bottom : 'no findings pill');
      setView('table'); await frames();
      ok(`table${squeeze ? ', squeezed' : ''}: the tabs start below the top row`, below(document.querySelector('#tableView .tv-head')),
        document.querySelector('#tableView .tv-head').getBoundingClientRect().top + ' < ' + bar.getBoundingClientRect().bottom);
    }
    ok('squeezed, the row really did grow', bar.getBoundingClientRect().height > 60, String(bar.getBoundingClientRect().height));
    bar.style.right = '';
    type('');
    setView('map'); await frames();
    ok('with no search the pill is back under a one-line row', Math.abs(parseFloat(getComputedStyle(el('conflictPill')).top) - (bar.offsetTop + bar.offsetHeight + 12)) < 1
      || !el('conflictPill').offsetParent, getComputedStyle(el('conflictPill')).top);
    el('conflictPill').style.transition = '';

    // ---- 6: Esc, the reduced view, the document ----
    type('cam');
    el('queryInput').focus();
    el('queryInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    ok('a first Esc empties the box and keeps the focus', el('queryInput').value === '' && state.query === '' && document.activeElement === el('queryInput'));
    el('queryInput').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    ok('the next one leaves it', document.activeElement !== el('queryInput'));
    type('type:camera');
    const docText = JSON.stringify(serializeDoc());
    ok('the query is not part of the document', !/type:camera/.test(docText));
    state.settings.advanced = false; applyProfile(); renderCanvasOnly();
    ok('a reduced view has no box and dims nothing', getComputedStyle(el('queryBar')).display === 'none' && !document.querySelector('#layer-nodes .q-dim'));
    state.settings.advanced = true; applyProfile(); renderCanvasOnly();
    ok('the full editor dims again', lit() === 'c1,c2');
    replaceDocument(lab(), { origin: 'file' });
    ok('opening another network keeps the search', lit() === 'c1,c2' && el('queryInput').value === 'type:camera');
    type('');

    // ---- 7: translated ----
    const keys = ['Search, e.g. type:camera', 'Search the map and table', 'Clear the search', 'Zoom to matches', 'Select matches',
      'Select every device that matches (on the Cables tab, every cable)', 'Rows: {n} of {total}', 'Devices: {n} of {total}',
      'Not understood, so nothing matches: {terms}', 'No rows match the search.', el('queryInput').dataset.i18nTitle || el('queryInput').getAttribute('data-i18n-title')];
    const { MESSAGES, locales } = window.CarinoI18N;
    const missing = keys.filter((k) => !locales.every((l) => MESSAGES[l][k]));
    ok('its sentences are in every locale', !missing.length, missing.join(' | '));
    ok('and the prefixes in them stay as typed', locales.every((l) => /type:camera/.test(MESSAGES[l]['Search, e.g. type:camera'])));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
