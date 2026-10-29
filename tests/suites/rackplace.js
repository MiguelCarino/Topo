// The place dialog, redesigned (js/rackview.js "The place dialog"): where the
// device goes is one line at the top, opened to change it; New device is a
// grid of types, a name and Add <type>; From the map lists the devices on the
// map. What is held here:
//   1. a rack with nothing waiting opens on New device: the title says Add to
//      the rack, the line says where it goes, the fields are folded away,
//      the server is picked first and the grid leads with rack gear and
//      leaves out VMs, containers and the cloud;
//   2. a click on a type picks it and Add is named after it; a name typed is
//      the new device's, blank keeps the usual one; Enter in the name adds;
//      one undo step each;
//   3. units that do not fit open the fields by themselves, say why, and
//      Add is off;
//   4. a rack with devices waiting opens on From the map, its tab counting
//      them, and the tabs switch the panes and Add's visibility;
//   5. Spanish: the title, the tabs and Add.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const held = setDialogResponder(() => null);
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, gw: '', dns: '', os: '', notes: '', nat: false,
    interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] }, extra);
  const site = (waiting) => ({ v: DOC_VERSION,
    nodes: [N('sw', 'switch', { group: 'rk', rackU: 40, portCount: 8, interfaces: [] }), N('pc', 'pc', { x: 300 })]
      .concat(waiting ? [N('srv', 'server', { group: 'rk', x: 100 })] : []),
    links: [], groups: [{ id: 'rk', name: 'Rack 1', kind: 'rack', uHeight: 42 }] });
  const open = (waiting) => { replaceDocument(site(waiting), { origin: 'file', docId: 'rkp-test' }); renderCanvasOnly(); };
  const types = () => [...el('rackPlaceTypes').querySelectorAll('.rkp-type')];
  const picked = () => types().filter((b) => b.getAttribute('aria-checked') === 'true').map((b) => b.dataset.type);
  const steps = () => _undoStack.length;
  try {
    // ---- 1. New device first ----
    open(false);
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 20, height: 1 });
    ok('the title says where it is added', el('rackPlaceTitle').textContent === 'Add to Rack 1', el('rackPlaceTitle').textContent);
    ok('one line says where it goes, the fields folded away', /^Goes in U20 front/.test(el('rackPlaceMsg').textContent) && !el('rackPlaceWhere').open);
    ok('nothing waiting: it opens on New device', !el('rackPlaceNewPane').hidden && el('rackPlaceMapPane').hidden
      && el('rackPlaceTabNew').getAttribute('aria-selected') === 'true');
    ok('the server is picked, and the grid leads with rack gear', picked().join() === 'server' && types().slice(0, 3).map((b) => b.dataset.type).join() === 'server,switch,l3switch');
    ok('no VM, container or cloud is offered', !types().some((b) => isVirtualType(b.dataset.type) || b.dataset.type === 'cloud'));
    ok('Add is named after the type and shown', /Add Server/i.test(el('rackPlaceNewBtn').textContent) && !el('rackPlaceNewBtn').hidden, el('rackPlaceNewBtn').textContent);

    // ---- 2. Pick, name, add ----
    types().find((b) => b.dataset.type === 'firewall').click();
    ok('a click picks a type and Add follows it', picked().join() === 'firewall' && el('rackPlaceType').value === 'firewall' && /Firewall/i.test(el('rackPlaceNewBtn').textContent));
    el('rackPlaceName').value = '  FW-EDGE-01 ';
    let before = steps();
    el('rackPlaceNewBtn').click();
    let made = state.nodes[state.nodes.length - 1];
    ok('Add makes it, with the name typed', made.type === 'firewall' && made.name === 'FW-EDGE-01' && made.rackU === 20 && made.group === 'rk' && el('rackPlaceDialog').hidden);
    ok('one undo step', steps() === before + 1);
    undo();
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 20, height: 1 });
    ok('opened again, the name is blank', el('rackPlaceName').value === '');
    el('rackPlaceName').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    made = state.nodes[state.nodes.length - 1];
    ok('Enter in the name adds it; blank keeps the usual name', !el('rackPlaceName').value && made.rackU === 20 && !!made.name && made.name !== 'FW-EDGE-01');
    undo();

    // ---- 3. Units that do not fit ----
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 20, height: 1 });
    el('rackPlaceU').value = '40';
    el('rackPlaceU').dispatchEvent(new Event('input', { bubbles: true }));
    ok('taken units open the fields, say why, and Add is off', el('rackPlaceWhere').open && /taken by SW/.test(el('rackPlaceMsg').textContent)
      && el('rackPlaceMsg').classList.contains('rkp-bad') && el('rackPlaceNewBtn').disabled, el('rackPlaceMsg').textContent);
    closePlaceDialog();

    // ---- 4. Devices waiting ----
    open(true);
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 20, height: 1 });
    ok('devices waiting: it opens on From the map, its tab counting them', !el('rackPlaceMapPane').hidden && el('rackPlaceNewPane').hidden
      && el('rackPlaceMapCount').textContent === '1' && el('rackPlaceNewBtn').hidden);
    ok('the waiting device is first', (el('rackPlaceList').querySelector('.rkp-item') || {}).dataset.node === 'srv');
    el('rackPlaceTabNew').click();
    ok('the New device tab switches the panes and shows Add', !el('rackPlaceNewPane').hidden && el('rackPlaceMapPane').hidden && !el('rackPlaceNewBtn').hidden);
    el('rackPlaceTabMap').click();
    ok('and back', !el('rackPlaceMapPane').hidden && el('rackPlaceNewBtn').hidden);
    closePlaceDialog();

    // ---- 5. Spanish ----
    setLocale('es'); applyStaticI18n();
    open(false);
    openPlaceDialog({ rackId: 'rk', face: 'front', u: 20, height: 1 });
    ok('es: the title, the tabs and Add', el('rackPlaceTitle').textContent === 'Añadir a Rack 1' && el('rackPlaceTabNew').textContent.trim() === 'Dispositivo nuevo'
      && /Del mapa/.test(el('rackPlaceTabMap').textContent) && /^Añadir /.test(el('rackPlaceNewBtn').textContent), [el('rackPlaceTitle').textContent, el('rackPlaceNewBtn').textContent].join(' | '));
    closePlaceDialog();
    setLocale('en'); applyStaticI18n();
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setDialogResponder(held);
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
