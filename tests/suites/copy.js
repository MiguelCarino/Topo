// Copy, paste and duplicate (js/copy.js): devices with the cables between
// them, and a group with everything in it. What is held here:
//   1. a copy takes the next free name and the next free address of its
//      subnet, and leaves MAC, serial number and asset tag blank; it keeps
//      its type, model and group, and loses its rack place;
//   2. cables are copied when both ends are; a VM follows its copied host;
//   3. Ctrl+C then Ctrl+V pastes, each paste a step further on and one undo
//      step; Ctrl+D duplicates and leaves the clipboard alone; Ctrl+C is the
//      browser's while text is selected and Ctrl+V while nothing was copied;
//   4. a full subnet leaves the address blank, and says so;
//   5. a group is duplicated with the groups and devices inside it, under the
//      next free name and the same parent; inside a copied rack the devices
//      keep their units; the group card has Duplicate and Copy;
//   6. pasted into another network, a copy goes in as a block does;
//   7. a read-only document refuses; the buttons and the words are there.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const json = (v) => JSON.stringify(v);
  // The copy of a group asks its name and kind: each question takes the next
  // answer queued here, and with none queued it is dismissed.
  const answers = [], asked = [];
  const accept = (req) => ({ value: req.value, pick: req.pick.value });
  const heldResponder = setDialogResponder((req) => { if (req.kind !== 'prompt') return false; asked.push(req); return answers.length ? answers.shift()(req) : null; });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw', 'switch', { name: 'Switch', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.2/24' }] }),
      N('pc', 'pc', { name: 'PC', x: 200, y: 0, model: 'OptiPlex', vendor: 'Dell', serial: 'SN-1', assetTag: 'A-1', group: 'off',
        interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24', mac: 'AA:BB:CC:00:00:01' }] }),
      N('ap', 'ap', { name: 'AP 3', x: 400, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }),
      N('s1', 'server', { name: 'Host', x: 0, y: 400, group: 'rk', rackU: 10, rackHeight: 2, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.1/30' }] }),
      N('s3', 'server', { name: 'Spare', x: 200, y: 400, group: 'rk', rackU: 20 }),
      N('vm', 'vm', { name: 'VM', x: 100, y: 400, group: 'rk', host: 's1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.1.2/30' }] })
    ],
    links: [
      { id: 'l1', source: 'sw', target: 'pc', sourceIface: 'i1', targetIface: 'i1' },
      { id: 'l2', source: 'sw', target: 'ap' }
    ],
    networks: [{ id: 'n1', name: 'Office', cidr: '10.0.0.0/24', gateway: '10.0.0.1' }],
    groups: [
      { id: 'off', name: 'Office', kind: 'room' },
      { id: 'srv', name: 'Server room', kind: 'room' },
      { id: 'rk', name: 'Rack 1', kind: 'rack', parent: 'srv', uHeight: 42 }
    ] });
  const open = (docId = 'doc-copy') => { replaceDocument(site(), { origin: 'file', docId }); state.camera.zoom = 1; state.camera.x = 300; state.camera.y = 300; applyCamera(); renderCanvasOnly(); };
  const pick = (...ids) => selectEntries(ids.map((id) => ({ type: 'node', id })));
  const key = (k, extra) => window.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, ctrlKey: true, bubbles: true, cancelable: true }, extra || {})));
  const toast = () => el('topoToast').textContent;
  const fresh = (before) => state.nodes.filter((n) => !before.has(n.id));
  const idsNow = () => new Set(state.nodes.map((n) => n.id));
  const ip = (n) => n.interfaces[0].ip;

  // The keys act on the map: not under the table, whatever view this browser was left in.
  const heldView = state.settings.view;
  try {
    setView('map');
    open();

    // ---- 1: what a copy keeps and what it does not ----
    let before = idsNow(), undoAt = _undoStack.length;
    pick('pc');
    const done = duplicateSelection();
    let made = fresh(before);
    ok('Duplicate makes one more device', made.length === 1 && done && done.nodeIds.length === 1);
    const c = made[0];
    ok('named with the next free number', c.name === 'PC 2', c.name);
    ok('at the next free address of its subnet, past the gateway and what is taken', ip(c) === '10.0.0.3/24', ip(c));
    ok('with no MAC, serial number or asset tag', !c.interfaces[0].mac && !c.serial && !c.assetTag);
    ok('the same type, vendor and model, in the same group', c.type === 'pc' && c.vendor === 'Dell' && c.model === 'OptiPlex' && c.group === 'off');
    ok('beside the original, on the grid', c.x === 240 && c.y === 40, json([c.x, c.y]));
    ok('the copy is what is selected', state.selectedId === c.id);
    ok('the original is untouched', getNode('pc').name === 'PC' && ip(getNode('pc')) === '10.0.0.10/24' && getNode('pc').serial === 'SN-1');
    ok('one undo step', _undoStack.length === undoAt + 1);
    ok('a toast says so, and what became of the address', /Duplicated 1 device\./.test(toast()) && /next free one/.test(toast()), toast());
    undo();
    ok('undone, it is gone', state.nodes.length === 6);

    before = idsNow();
    pick('ap'); duplicateSelection();
    ok('a name that ends in a number counts on from it', fresh(before)[0].name === 'AP 4', fresh(before)[0].name);
    ok('a device with no address gets none', ip(fresh(before)[0]) === '');
    undo();

    before = idsNow();
    pick('s1'); duplicateSelection();
    made = fresh(before);
    ok('a device copied out of a rack stays in the group but takes no units', made[0].group === 'rk' && made[0].rackU === undefined && made[0].rackHeight === undefined);
    undo();

    // ---- 2: cables and hosts ----
    before = idsNow();
    const linksBefore = state.links.length;
    pick('sw', 'pc'); duplicateSelection();
    made = fresh(before);
    const newLinks = state.links.slice(linksBefore);
    ok('two devices copied bring the cable between them', made.length === 2 && newLinks.length === 1);
    ok('which joins the copies, on the same ports', made.some((n) => n.id === newLinks[0].source) && made.some((n) => n.id === newLinks[0].target) && newLinks[0].sourceIface === 'i1' && newLinks[0].targetIface === 'i1');
    ok('a cable to a device that was not copied is not', !newLinks.some((l) => l.target === 'ap' || l.source === 'ap'));
    ok('the two copies have different addresses', ip(made[0]) !== ip(made[1]) && /^10\.0\.0\.\d+\/24$/.test(ip(made[0])) && /^10\.0\.0\.\d+\/24$/.test(ip(made[1])), json(made.map(ip)));
    undo();
    before = idsNow();
    pick('s1', 'vm'); duplicateSelection();
    made = fresh(before);
    ok('a VM copied with its host sits on the copy of the host', made.find((n) => n.name === 'VM 2').host === made.find((n) => n.name === 'Host 2').id);
    // ---- 4: a full subnet ----
    ok('a /30 with both hosts taken leaves the copies without an address', made.every((n) => ip(n) === ''));
    ok('and says how many', /2 addresses were left blank/.test(toast()), toast());
    undo();
    before = idsNow();
    pick('vm'); duplicateSelection();
    ok('a VM copied alone stays on its host', fresh(before)[0].host === 's1');
    undo();

    // ---- 3: the keys ----
    before = idsNow(); undoAt = _undoStack.length;
    pick('pc');
    key('c');
    ok('Ctrl+C copies and changes nothing', state.nodes.length === 6 && hasCopied() && _undoStack.length === undoAt && /Copied 1 device/.test(toast()), toast());
    key('v');
    ok('Ctrl+V pastes it', fresh(before).length === 1 && /Pasted 1 device\./.test(toast()), toast());
    key('v');
    made = fresh(before);
    ok('again pastes another, a step further on', made.length === 2 && made[1].x === 280 && made[1].y === 80 && made[1].name === 'PC 3', json(made.map((n) => [n.name, n.x, n.y])));
    ok('each paste is one undo step', _undoStack.length === undoAt + 2);
    undo(); undo();
    before = idsNow();
    pick('ap');
    key('d');
    ok('Ctrl+D duplicates the selection', fresh(before).length === 1 && fresh(before)[0].type === 'ap');
    undo();
    before = idsNow();
    key('v');
    ok('and leaves the clipboard as it was', fresh(before).length === 1 && fresh(before)[0].type === 'pc');
    undo();
    pick('pc');
    const evShift = new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
    const words = document.createElement('p'); words.textContent = 'some text on the page'; words.style.cssText = 'position:fixed;left:0;top:0;user-select:text;-webkit-user-select:text'; document.body.appendChild(words);
    const range = document.createRange(); range.selectNodeContents(words); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    window.dispatchEvent(evShift);
    ok('with text selected on the page, Ctrl+C is left to the browser', !evShift.defaultPrevented);
    sel.removeAllRanges(); words.remove();
    _clip = null;
    const evPaste = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(evPaste);
    ok('with nothing copied, Ctrl+V is left to the browser', !evPaste.defaultPrevented && state.nodes.length === 6);
    select(null, null);
    ok('nothing selected: Copy asks for a selection', copySelection() === null && /Select the devices to copy first/.test(toast()));

    // ---- 5: groups ----
    before = idsNow(); undoAt = _undoStack.length;
    const groupsBefore = state.groups.length;
    asked.length = 0; answers.push(accept);
    const dup = await duplicateGroup('srv');
    made = fresh(before);
    const room = groupById(dup.groupId), rack = state.groups.find((g) => g.parent === room.id);
    ok('making the copy asks for its name, offering the next free one', asked.length === 1 && asked[0].value === 'Server room 2' && /copy of Server room/.test(asked[0].message), asked[0] && asked[0].value);
    ok('and offers the kinds, with the original\'s chosen', asked[0].pick.value === 'room' && json(asked[0].pick.options.map((o) => o.id)) === json(GROUP_KINDS));
    ok('a group is duplicated with the group inside it', state.groups.length === groupsBefore + 2 && !!room && !!rack);
    ok('accepted as offered: the next free name, the same kind, the same parent', room.name === 'Server room 2' && room.kind === 'room' && !room.parent, json(room));
    ok('the rack inside keeps its name and its size', rack.name === 'Rack 1' && rack.kind === 'rack' && rack.uHeight === 42);
    ok('with every device in it, in the copied groups', made.length === 3 && made.every((n) => n.group === rack.id));
    ok('which keep their units in the copied rack', made.find((n) => n.name === 'Host 2').rackU === 10 && made.find((n) => n.name === 'Host 2').rackHeight === 2);
    ok('standing clear of the original', Math.min(...made.map((n) => n.x)) > 200);
    ok('one undo step for the lot', _undoStack.length === undoAt + 1);
    ok('a toast names the new group', /Duplicated as Server room 2, with 3 devices\./.test(toast()), toast());
    undo();
    ok('undone, groups and devices are gone', state.groups.length === groupsBefore && state.nodes.length === 6);

    // a name of its own, and another kind
    before = idsNow();
    answers.push(() => ({ value: 'Lab', pick: 'floor' }));
    const named = await duplicateGroup('srv');
    ok('a name typed there is the copy\'s name, and a kind picked there its kind', groupById(named.groupId).name === 'Lab' && groupById(named.groupId).kind === 'floor' && groupById('srv').kind === 'room');
    undo();
    before = idsNow();
    answers.push(() => ({ value: 'Shelf', pick: 'custom' }));
    const shelf = await duplicateGroup('rk');
    made = fresh(before);
    ok('a rack copied as something else is that, in the same parent', groupById(shelf.groupId).kind === 'custom' && groupById(shelf.groupId).parent === 'srv' && groupById(shelf.groupId).uHeight === undefined, json(groupById(shelf.groupId)));
    ok('and its devices have no rack units there', made.length === 3 && made.every((n) => n.group === shelf.groupId && n.rackU === undefined && n.rackHeight === undefined));
    undo();
    answers.push(() => ({ value: '   ', pick: 'rack' }));
    const blankName = await duplicateGroup('rk');
    ok('a name left blank is the next free one', groupById(blankName.groupId).name === 'Rack 2' && groupById(blankName.groupId).parent === 'srv', groupById(blankName.groupId).name);
    undo();
    undoAt = _undoStack.length; before = idsNow();
    const dismissed = await duplicateGroup('srv');
    ok('the question dismissed, nothing is made and nothing is filed', dismissed === null && fresh(before).length === 0 && state.groups.length === groupsBefore && _undoStack.length === undoAt);

    // from the card, and Ctrl+V
    showConfigTab('groups'); renderGroupsPanel(true);
    const card = document.querySelector('[data-grp="srv"][data-act="duplicate"]'), copyBtn = document.querySelector('[data-grp="srv"][data-act="copy"]');
    ok('the group card has Duplicate and Copy', !!card && !!copyBtn);
    asked.length = 0;
    copyBtn.click();
    ok('Copy on the card asks nothing yet', asked.length === 0 && /Copied Server room/.test(toast()), toast());
    before = idsNow();
    answers.push(() => ({ value: 'Server room B', pick: 'room' }));
    key('v'); await tick(); await tick();
    ok('Ctrl+V asks, then pastes the group under the name given', asked.length === 1 && state.groups.some((g) => g.name === 'Server room B') && fresh(before).length === 3 && /Pasted Server room B with 3 devices\./.test(toast()), toast());
    undo();

    // from the map: a group's devices selected (a click on its tab) are the group
    selectGroupMembers('srv');
    ok('every device of a group selected is that group', wholeGroupSelected() && wholeGroupSelected().id === 'srv');
    before = idsNow(); asked.length = 0;
    answers.push(accept);
    key('d'); await tick(); await tick();
    ok('Ctrl+D then duplicates the group, asking its name', asked.length === 1 && state.groups.some((g) => g.name === 'Server room 2') && fresh(before).length === 3);
    undo();
    selectGroupMembers('srv');
    asked.length = 0;
    key('c');
    ok('and Ctrl+C copies the group', asked.length === 0 && /Copied Server room\. Ctrl\+V pastes it\./.test(toast()), toast());
    pick('s1', 'vm');
    ok('some of a group\'s devices are just devices', wholeGroupSelected() === null);
    pick('pc');
    ok('and so is one device, even alone in its group', wholeGroupSelected() === null);
    _clip = null;

    // ---- 6: into another network ----
    pick('sw', 'pc');
    copySelection();
    replaceDocument({ v: DOC_VERSION, nodes: [N('x1', 'pc', { name: 'PC', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.10/24' }] })], links: [], networks: [{ id: 'nx', name: 'Office', cidr: '10.0.0.0/24' }], groups: [] }, { origin: 'file', docId: 'doc-other' });
    before = idsNow();
    const far = pasteCopied();
    made = fresh(before);
    ok('pasted into another network, the devices and their cable arrive', !!far && made.length === 2 && state.links.length === 1);
    ok('in no group, and in a subnet of their own', made.every((n) => !n.group) && made.every((n) => !/^10\.0\.0\./.test(ip(n))), json(made.map(ip)));
    ok('one undo step there too', (undo(), state.nodes.length === 1));

    // ---- 7: read-only, the buttons, the words ----
    open();
    pick('sw', 'pc');
    ok('a set of devices shows Copy and Duplicate in the rail', !el('selCopyRow').classList.contains('hidden') && !!el('selCopyBtn') && !!el('selDuplicateBtn'));
    before = idsNow();
    el('selDuplicateBtn').click();
    ok('the rail\'s Duplicate duplicates', fresh(before).length === 2);
    undo();
    selectEntries([{ type: 'link', id: 'l1' }, { type: 'link', id: 'l2' }]);
    ok('a set of cables alone does not', el('selCopyRow').classList.contains('hidden'));
    pick('pc'); renderCanvasOnly();
    ok('one selected device carries a duplicate mark beside its delete mark', el('ui-node-pc').querySelectorAll('.node-delete').length === 2);
    state.readOnly = { doc: site() };
    before = idsNow();
    pick('pc');
    ok('a read-only network is not added to', duplicateSelection() === null && duplicateGroup('srv') === null && fresh(before).length === 0);
    state.readOnly = null;
    ok('the shortcut list names the three keys', ['Copy the selected devices', 'Paste what was copied', 'Duplicate the selected devices'].every((l) => SHORTCUTS.some((s) => s.label === l && s.mod)));
    setLocale('es'); applyStaticI18n();
    pick('pc'); duplicateSelection();
    ok('the words are translated', /Se duplicó 1 dispositivo\./.test(toast()) && el('selDuplicateBtn').textContent === 'Duplicar', toast());
    undo();
    setLocale('en'); applyStaticI18n(); renderCanvasOnly();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(heldResponder);
    showConfigTab('config');
    if (heldView && heldView !== state.settings.view) setView(heldView);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
