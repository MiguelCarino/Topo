// Inventory, stage 3 (docs/BACKLOG.md feature 3, landing order step 13):
// vendor from the MAC. A device's MACs name who made its network card
// (js/oui.js, the table shared with hardware.carino.systems, about 35
// makers); a blank Vendor is offered that maker as a hint, never written by
// itself. What is held here:
//   1. macVendorSuggestion / macVendorRead, pure: a Dell OUI gives Dell;
//      a locally administered (02:…) MAC, a multicast one, an Intel
//      Corporate (chip maker) NIC, a VMware, QEMU/KVM or Docker (virtual,
//      the last two with the local bit set) NIC, two NICs naming
//      different makers and a MAC not in the table give none, each with its
//      reason; a chip NIC beside a Dell one still gives Dell; ASUSTek shows
//      as ASUS, MSI (Micro-Star) as MSI, HP / HPE as HPE on a server or
//      switch and HP on a PC; it is stored nowhere;
//   2. the device editor: the Vendor field's grey text "{value} · from the
//      MAC" and its Use button (one undo step), nothing written by showing
//      it, a typed vendor never replaced (the hint goes while one is typed and
//      comes back when it is emptied), the hint following a MAC typed in the
//      interface editor, a cleared MAC or deleted NIC taking it away and a
//      disagreeing NIC deleted bringing it, no Use on a read-only network;
//   3. the Table's Vendor cell: the suggestion greyed with its title, the
//      device's own vendor as it is, its editor opening blank, a paste
//      seeing the record's blank, viewing it writing nothing; the report
//      (device list, a printed saved search's Vendor column and its sort),
//      devices.csv and vendor: not seeing it;
//   4. Change all's "Fill vendor from MAC": offered while some device has no
//      vendor, its preview filling only the blank ones and naming the others
//      with their reasons, Apply one undo step, nothing typed overwritten;
//   5. the words in es, pt-BR, ja and ru.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const show = (v) => JSON.stringify(v);
  const steps = () => _undoStack.length;
  const heldToast = window.showToast;
  window.showToast = () => {};
  const DELL = '00:14:22:01:02:03', INTEL = '00:1B:21:01:02:03', VMW = '00:50:56:01:02:03', HP = '00:17:08:01:02:03';
  const QEMU = '52:54:00:12:34:56', DOCKER = '02:42:AC:11:00:02';
  const ASUS = '00:0C:6E:01:02:03', UNKNOWN = '00:11:11:01:02:03', LOCAL = '02:14:22:01:02:03', MCAST = '01:00:5E:01:02:03';
  const nic = (id, mac) => ({ id, name: 'eth' + id.slice(1), ip: '', mac });
  const dev = (id, name, type, macs, extra) => ({ id, type, name, x: 0, y: 0, interfaces: macs.map((m, i) => nic('i' + (i + 1), m)), ...(extra || {}) });
  const lab = () => ({ v: DOC_VERSION, links: [], nodes: [
    dev('dell', 'PC-DELL', 'pc', [DELL]),
    dev('loc', 'PHONE', 'pc', [LOCAL]),
    dev('mc', 'MC', 'pc', [MCAST]),
    dev('intel', 'PC-INTEL', 'pc', [INTEL]),
    dev('vm', 'VM-1', 'vm', [VMW]),
    dev('two', 'PC-TWO', 'pc', [DELL, HP]),
    dev('unk', 'PRN-1', 'printer', [UNKNOWN]),
    dev('none', 'CAM-1', 'camera', []),
    dev('mix', 'PC-MIX', 'pc', [INTEL, DELL]),
    dev('typed', 'PC-TYPED', 'pc', [DELL], { vendor: 'Lenovo' }),
    dev('srv', 'SRV-1', 'server', [HP]),
    dev('hpc', 'PC-HP', 'pc', [HP]),
    dev('asus', 'PC-ASUS', 'pc', [ASUS]),
    dev('kvm', 'VM-KVM', 'vm', [QEMU]),
    dev('dock', 'CT-1', 'vm', [DOCKER])
  ] });
  const open = (doc) => {
    replaceDocument(doc || lab(), { origin: 'file' }); initHistory();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };
  setLocale('en');

  try {
    // ---- 1. The pure reading ----
    open();
    const sug = (id) => { const s = macVendorSuggestion(getNode(id)); return s ? s.vendor : null; };
    const why = (id) => macVendorRead(getNode(id)).why;
    ok('a Dell OUI gives Dell, naming the interface', show(macVendorSuggestion(getNode('dell'))) === '{"vendor":"Dell","from":["eth1"]}', show(macVendorSuggestion(getNode('dell'))));
    ok('a locally administered MAC gives none (randomised)', sug('loc') === null && why('loc') === 'random');
    ok('a multicast MAC gives none', sug('mc') === null && why('mc') === 'random');
    ok('an Intel Corporate NIC gives none (a chip maker)', sug('intel') === null && why('intel') === 'chip');
    ok('a VMware NIC gives none (virtual)', sug('vm') === null && why('vm') === 'virtual');
    ok('a QEMU/KVM NIC (local bit set) is a virtual machine\'s, not randomised', sug('kvm') === null && why('kvm') === 'virtual', why('kvm'));
    ok('a Docker NIC (02:42, local bit set) too', sug('dock') === null && why('dock') === 'virtual', why('dock'));
    ok('two NICs naming different makers give none', sug('two') === null && why('two') === 'disagree');
    ok('a MAC not in the table gives none', sug('unk') === null && why('unk') === 'unknown');
    ok('no MAC gives none', sug('none') === null && why('none') === 'none');
    ok('a chip NIC beside a Dell one: Dell', sug('mix') === 'Dell');
    ok('HP / HPE is HPE on a server, HP on a PC', sug('srv') === 'HPE' && sug('hpc') === 'HP');
    ok('ASUSTek shows as ASUS', sug('asus') === 'ASUS');
    ok('the reading does not look at a typed vendor (the callers do)', sug('typed') === 'Dell' && vendorHintFor(getNode('typed')) === null && vendorHintFor(getNode('dell')).vendor === 'Dell');
    ok('MSI (Micro-Star) shows as MSI', ouiVendorShown('MSI (Micro-Star)', getNode('dell')) === 'MSI');
    ok('it is stored nowhere', !('vendor' in getNode('dell')) && !JSON.stringify(serializeDoc()).includes('"Dell"'));

    // ---- 2. The device editor ----
    open();
    const before = JSON.stringify(serializeDoc());
    select('dell', 'node');
    const useOn = () => !el('vendorUseBtn').classList.contains('hidden');
    ok('a blank Vendor shows the MAC\'s maker as its grey text', el('propVendor').value === '' && el('propVendor').placeholder === 'Dell · from the MAC', el('propVendor').placeholder);
    ok('with a title saying it is not saved', el('propVendor').title === "Suggested from the network card's MAC address. Not saved until you use it or type a vendor.");
    ok('and a Use button beside the label', useOn() && el('vendorUseBtn').textContent === 'Use' && el('assetGroup').contains(el('vendorUseBtn')));
    ok('showing it writes nothing', JSON.stringify(serializeDoc()) === before && getNode('dell').vendor === undefined && steps() === 0);
    let n0 = steps();
    el('vendorUseBtn').click();
    ok('Use writes it in one undo step', getNode('dell').vendor === 'Dell' && steps() === n0 + 1, `${getNode('dell').vendor} ${steps() - n0}`);
    ok('the field then holds it and the hint goes', el('propVendor').value === 'Dell' && el('propVendor').placeholder === '' && !useOn());
    undo();
    ok('Undo takes it back, and the hint is there again', getNode('dell').vendor === undefined && el('propVendor').placeholder === 'Dell · from the MAC' && useOn());
    select('typed', 'node');
    ok('a typed vendor is kept and no hint is offered', el('propVendor').value === 'Lenovo' && el('propVendor').placeholder === '' && !useOn());
    const typeInto = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); };
    select('dell', 'node');
    typeInto(el('propVendor'), 'Acme');
    ok('typing a vendor takes the hint away', !useOn() && el('propVendor').placeholder === '' && getNode('dell').vendor === 'Acme');
    typeInto(el('propVendor'), '');
    ok('emptying it brings the hint back, nothing written', useOn() && el('propVendor').placeholder === 'Dell · from the MAC' && !('vendor' in getNode('dell')));
    commitTyping();
    select('intel', 'node');
    ok('a chip maker\'s NIC: no hint, no Use', el('propVendor').placeholder === '' && !useOn());
    select('none', 'node');
    ok('a device with no MAC: no hint', el('propVendor').placeholder === '' && !useOn());
    // A MAC typed in the interface editor: the hint follows it.
    const macInput = () => el('ifaceListContainer').querySelector('.if-mac input.if-in');
    select('intel', 'node');
    const mi = macInput();
    ok('the interface editor has the MAC field', !!mi && mi.value === INTEL);
    if (mi) {
      typeInto(mi, VMW);
      ok('a MAC typed in the interface editor keeps the hint away (VMware: none)', el('propVendor').placeholder === '' && !useOn(), el('propVendor').placeholder);
      typeInto(mi, DELL);
      ok('and a Dell MAC typed there brings it', el('propVendor').placeholder === 'Dell · from the MAC' && useOn(), el('propVendor').placeholder);
      commitTyping();
    }
    // Clearing the MAC, deleting or adding a NIC: the hint follows the NICs.
    const delBtn = (re) => [...el('ifaceListContainer').querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') || ''));
    open();
    select('dell', 'node');
    const clr = delBtn(/^Clear this address$/);
    ok('the MAC line has its clear button', !!clr);
    if (clr) clr.click();
    ok('clearing the MAC takes the hint and Use away', getNode('dell').interfaces[0].mac === '' && el('propVendor').placeholder === '' && !useOn(), el('propVendor').placeholder);
    open();
    select('dell', 'node');
    const del = delBtn(/^Delete eth1 and any cable in it$/);
    ok('the interface has its delete button', !!del);
    if (del) del.click();
    ok('deleting the interface takes the hint and Use away', !getNode('dell').interfaces.length && el('propVendor').placeholder === '' && !useOn(), el('propVendor').placeholder);
    open();
    select('two', 'node');
    ok('two makers: no hint', el('propVendor').placeholder === '' && !useOn());
    const delHp = delBtn(/^Delete eth2 and any cable in it$/);
    if (delHp) delHp.click();
    ok('deleting the HP NIC brings the Dell hint', getNode('two').interfaces.length === 1 && el('propVendor').placeholder === 'Dell · from the MAC' && useOn(), el('propVendor').placeholder);
    open();
    select('dell', 'node');
    ok('useVendorHint on a device with a vendor writes nothing', useVendorHint(getNode('typed')) === null && getNode('typed').vendor === 'Lenovo');
    replaceDocument({ v: DOC_VERSION + 1, links: [], nodes: [dev('dell', 'PC-DELL', 'pc', [DELL])] }, { origin: 'file' });
    select('dell', 'node');
    ok('a read-only network: the hint, but no Use', el('propVendor').placeholder === 'Dell · from the MAC' && !useOn());
    ok('and useVendorHint writes nothing there', useVendorHint(getNode('dell')) === null && getNode('dell').vendor === undefined);

    // ---- 3. The Table, the report, CSV and search ----
    open();
    const before3 = JSON.stringify(serializeDoc());
    setView('table'); showTableTab('devices');
    const vcell = (id) => el('tvGrid').querySelector(`tbody tr[data-row="n:${id}"] td[data-col="vendor"]`);
    ok('a blank Vendor cell shows the suggestion greyed', vcell('dell') && vcell('dell').textContent === 'Dell' && vcell('dell').classList.contains('tv-muted'), vcell('dell') && vcell('dell').outerHTML);
    ok('with the title saying it is not saved', vcell('dell').title === "Suggested from the network card's MAC address. Not saved until you use it or type a vendor.");
    ok('a typed vendor shows as it is, not greyed', vcell('typed').textContent === 'Lenovo' && !vcell('typed').classList.contains('tv-muted'));
    ok('no suggestion: an empty cell', vcell('intel').textContent === '' && vcell('vm').textContent === '' && vcell('srv').textContent === 'HPE');
    ok('showing the table writes nothing', JSON.stringify(serializeDoc()) === before3);
    const vcol = TV_COLS.devices.find((c) => c.key === 'vendor');
    startEdit(vcell('dell'));
    ok('editing the greyed cell starts blank (the record holds none)', !!_tv.editor && _tv.editor.el.value === '', _tv.editor && show(_tv.editor.el.value));
    cancelEdit();
    ok('and leaving it writes nothing', JSON.stringify(serializeDoc()) === before3);
    // A paste over it: what is there now is the record's (blank), not the hint.
    const drow = (id) => _tv.rows.find((r) => r.key === 'n:' + id);
    const pp = planPaste('vendor', 'Lenovo\nDell', { rows: [drow('dell'), drow('srv')], mode: 'selected' });
    ok('a paste reads the blank vendor as blank, not the suggestion', pp.cells[0].now === '' && pp.cells[0].status === 'change' && pp.cells[1].now === '' && pp.cells[1].status === 'change', show(pp.cells.map((c) => [c.now, c.status])));
    const pt = planPaste('vendor', 'Lenovo', { rows: [drow('typed')], mode: 'selected' });
    ok('a typed vendor is what a paste sees there', pt.cells[0].now === 'Lenovo' && pt.cells[0].status === 'same', show(pt.cells.map((c) => [c.now, c.status])));
    setView('map');
    const rd = reportDevices().find((d) => d.id === 'dell' || (d.node && d.node.id === 'dell') || d.name === 'PC-DELL');
    ok('the report does not print the suggestion', rd && !rd.vendor, show(rd && rd.vendor));
    // A printed saved search with the Vendor column prints the record's own.
    const heldSearches = state.searches;
    state.searches = [{ id: 'sq_v', name: 'Vendors', query: 'type:pc', columns: ['name', 'vendor'], sort: 'vendor', print: true }];
    const ps = reportSearches();
    const vIdx = ps[0] ? ps[0].columns.findIndex((c) => c.label === 'Vendor') : -1;
    const cellOf = (name) => { const r = ps[0] && ps[0].rows.find((x) => x.name === name); return r ? r.cells[vIdx] : undefined; };
    ok('a printed saved search leaves a suggested-only vendor blank', vIdx >= 0 && cellOf('PC-DELL') === '' && cellOf('PC-TYPED') === 'Lenovo', show(ps[0] && ps[0].rows.map((r) => [r.name, r.cells[vIdx]])));
    ok('and sorts by the printed vendor (the typed one first, blanks last)', ps[0] && ps[0].rows[0].name === 'PC-TYPED', show(ps[0] && ps[0].rows.map((r) => r.name)));
    state.searches = heldSearches;
    const csvText = JSON.stringify(csvDevicesSheet());
    ok('devices.csv does not carry it', !csvText.includes('"Dell"') && csvText.includes('"Lenovo"'));
    const q = parseQuery('vendor:dell');
    ok('vendor:dell does not match a suggested-only vendor', !queryMatch(q, 'node', getNode('dell')) && queryMatch(parseQuery('vendor:lenovo'), 'node', getNode('typed')));
    ok('mac:dell still finds it by its OUI', queryMatch(parseQuery('mac:dell'), 'node', getNode('dell')));

    // ---- 4. Change all: Fill vendor from MAC ----
    open();
    const pick = (ids) => selectEntries(ids.map((id) => ({ type: 'node', id })));
    const bShown = (id) => !el(id).classList.contains('hidden');
    pick(['dell', 'typed', 'intel', 'loc', 'unk', 'two', 'vm', 'none', 'srv']);
    ok('Set fields offers Fill vendor from MAC', bShown('bulkPanel') && bShown('bulkVendorMac') && el('bulkVendorMacBtn').textContent === 'Fill vendor from MAC');
    const plan = bulkPlanVendorFromMac(selectedOf('node'));
    const st = (id) => { const r = plan.rows.find((x) => x.nodeId === id); return r ? r.status + '|' + (r.status === 'change' ? r.after : r.why) : 'none'; };
    ok('only blank vendors are filled', st('dell') === 'change|Dell' && st('srv') === 'change|HPE' && plan.ops.length === 2, show(plan.ops));
    ok('a typed vendor is kept, and said so', st('typed') === 'skip|Already has a vendor: kept.', st('typed'));
    ok('the refused ones are named with their reasons', st('intel') === "skip|Its MAC names the network chip's maker, not the device's."
       && st('loc') === 'skip|Its MAC is randomised or a group address, so it names no maker.'
       && /not in the built-in list \(about 35 makers/.test(st('unk')) && st('two') === 'skip|Its MACs name different makers.'
       && st('vm') === "skip|Its MAC is a virtual machine's, so it names no maker." && st('none') === 'skip|No MAC address is recorded.', [st('intel'), st('loc'), st('unk'), st('two'), st('vm'), st('none')].join(' / '));
    ok('counted: 2 to change, 7 left as they are', plan.counts.change === 2 && plan.counts.skip === 7, show(plan.counts));
    n0 = steps();
    el('bulkVendorMacBtn').click();
    ok('the button opens the preview', !el('bulkDialog').hidden && el('bulkTitle').textContent === 'Fill vendor from MAC');
    ok('which says what it does, and that the list is short', /about 35 makers/.test(el('bulkBlurb').textContent), el('bulkBlurb').textContent);
    ok('and lists every device', el('bulkPreview').querySelectorAll('tr').length === 9 && el('bulkPreview').querySelectorAll('tr.paste-change').length === 2
       && /Already has a vendor: kept\./.test(el('bulkPreview').textContent));
    ok('nothing is written before Apply', getNode('dell').vendor === undefined && steps() === n0);
    el('bulkApplyBtn').click();
    ok('Apply fills the blank ones in one undo step', getNode('dell').vendor === 'Dell' && getNode('srv').vendor === 'HPE' && steps() === n0 + 1, `${steps() - n0}`);
    ok('nothing typed is overwritten, nothing given to the refused', getNode('typed').vendor === 'Lenovo' && ['intel', 'loc', 'unk', 'two', 'vm', 'none'].every((id) => getNode(id).vendor === undefined));
    undo();
    ok('Undo takes all of it back', getNode('dell').vendor === undefined && getNode('srv').vendor === undefined);
    pick(['typed', 'dell']);
    getNode('dell').vendor = 'Dell';
    renderBulkPanel(true);
    ok('a set where every device has a vendor is not offered it', !bShown('bulkVendorMac'));
    delete getNode('dell').vendor;
    selectEntries([]);

    // ---- 5. Words ----
    const { MESSAGES } = window.CarinoI18N;
    const keys = ['Use', '{value} · from the MAC', "Suggested from the network card's MAC address. Not saved until you use it or type a vendor.",
      'Fill vendor from MAC', 'Already has a vendor: kept.', ...Object.values(MAC_VENDOR_WHY),
      'Each device with no vendor takes the maker its MAC address names. The built-in list knows about 35 makers, so printers, cameras and phones often get none. A vendor already there is kept.'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const missing = keys.filter((k) => !MESSAGES[loc][k] || MESSAGES[loc][k] === k);
      ok(`${loc} translates the MAC vendor's words`, !missing.length, missing.join(' | '));
      ok(`${loc} keeps {value}`, /\{value\}/.test(MESSAGES[loc]['{value} · from the MAC']));
    });
    ok('Japanese says メーカー for the maker', /メーカー/.test(MESSAGES.ja['Fill vendor from MAC']));
    open();
    setLocale('es'); applyStaticI18n();
    select('dell', 'node');
    ok('the hint in Spanish', el('propVendor').placeholder === 'Dell · según la MAC' && el('vendorUseBtn').textContent === 'Usar', `${el('propVendor').placeholder} ${el('vendorUseBtn').textContent}`);
    setLocale('en');
    applyStaticI18n();
  } catch (e) {
    ok('suite ran without throwing', false, e && (e.stack || e.message));
  } finally {
    window.showToast = heldToast;
  }

  const pre = document.createElement('pre');
  pre.id = 'TESTOUT';
  pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 300); });
