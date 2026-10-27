// Changes since the last back-up (plan section 4, js/changes.js): a back-up
// or a report of a kept network stores a copy of it beside its card (the
// baseline, one per card, the latest replacing the one before), and the
// changes are the difference between that copy and the card now, matched by
// id. Asserted here:
//   1. the diff: devices, interfaces, cables, subnets, text notes, accepted
//      findings and the report header, by id; a rename is one device changed,
//      a moved-only device is said once for all of them, and an unchanged
//      document (or the same one written by an older build) is no change;
//   2. what takes a baseline: Back up this network, Back up all and a report
//      (site and binder), each replacing the last; deleting the card drops it;
//   3. the card: "± n changes since the last back-up" (silent at zero), the
//      list behind it, guest cards never;
//   4. the report: the section with what changed, then the report is the new
//      baseline; no baseline, no section, and the sheet is byte for byte the
//      one it was;
//   5. privacy: the baseline is never in a card, the binder file, a binder
//      link, a document link or the back-up file;
//   6. the store: a disk's baselines adopted, junk skipped, a newer one taken
//      in this tab written over the disk's, writes and deletes reaching it;
//      without IndexedDB (as here) this tab only;
//   7. Spanish.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const C = window.CarinoChanges;
  const L = window.CarinoLibrary;
  const { LIBRARY_KEY, BINDER_EXPORT_KEY } = L;
  const held = [LIBRARY_KEY, BINDER_EXPORT_KEY].map((k) => [k, localStorage.getItem(k)]);
  const heldLib = L.loadLibrary();
  const heldResponder = setDialogResponder(() => undefined);
  const realDownload = window.downloadJson, realDeliver = window.deliverReport, realCapture = window.captureCanvasImage;
  const heldLocale = state.settings.lang || 'en';
  let downloads = [];
  window.downloadJson = (payload, name) => { downloads.push({ payload: JSON.parse(JSON.stringify(payload)), name }); };
  let delivered = [];
  window.deliverReport = (html, meta) => { delivered.push(html); return { opened: true }; };
  window.captureCanvasImage = async () => null;

  const site = () => ({
    v: DOC_VERSION,
    nodes: [
      { id: 'rt', type: 'router', name: 'Core', x: 0, y: 0, interfaces: [{ id: 'e0', name: 'eth0', ip: '10.0.0.1/24' }] },
      { id: 'sw', type: 'switch', name: 'SW-1', x: 0, y: 100, portCount: 8, interfaces: [] },
      { id: 'pc1', type: 'pc', name: 'PC-1', x: 100, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.11/24' }] },
      { id: 'pc2', type: 'pc', name: 'PC-2', x: 200, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.12/24' }] },
      { id: 'old', type: 'printer', name: 'BASELINE-ONLY-7731', x: 300, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.40/24' }] }
    ],
    links: [
      { id: 'up', source: 'rt', target: 'sw', sourceIface: 'e0', targetIface: 'p8' },
      { id: 'a', source: 'sw', target: 'pc1', sourceIface: 'p1', targetIface: 'i1' },
      { id: 'b', source: 'sw', target: 'pc2', sourceIface: 'p2', targetIface: 'i1', cable: { label: 'WS-02' } },
      { id: 'c', source: 'sw', target: 'old', sourceIface: 'p3', targetIface: 'i1' }
    ],
    networks: [{ id: 'lan', cidr: '10.0.0.0/24', name: 'LAN', gateway: '10.0.0.1' }],
    report: { site: 'Clínica Norte', client: 'Grupo Norte' }
  });
  // The same site a while later: PC-1 renamed and given a gateway of its own,
  // PC-2's address changed and a second NIC, the printer gone (with its
  // cable), a camera added, the switch only moved, WS-02 relabelled, the LAN
  // given a VLAN and a guest network added, a text note, an accepted finding,
  // and the header's reference filled in.
  const later = () => {
    const d = site();
    d.nodes[2].name = 'Recepción'; d.nodes[2].gw = '10.0.0.254';
    d.nodes[3].interfaces[0].ip = '10.0.0.22/24'; d.nodes[3].interfaces.push({ id: 'i2', name: 'wlan0', ip: '' });
    d.nodes.splice(4, 1); d.links.splice(3, 1);
    d.nodes.push({ id: 'cam', type: 'camera', name: 'CAM-01', x: 400, y: 200, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.50/24' }] });
    d.links.push({ id: 'd', source: 'sw', target: 'cam', sourceIface: 'p4', targetIface: 'i1' });
    d.nodes[1].x = 40; d.nodes[1].y = 140;
    d.links[2].cable = { label: 'WS-12' };
    d.networks[0].vlan = 10;
    d.networks.push({ id: 'guest', cidr: '192.168.50.0/24', name: 'Guest' });
    d.annotations = [{ id: 't1', x: 10, y: 10, text: 'Rack A' }];
    d.accepted = [{ check: 'gw-reach', nodeIds: ['pc1'], reason: 'Lab bench' }];
    d.report.ref = 'CS-2026-014';
    return d;
  };
  const keep = (doc, name) => {
    replaceDocument(doc, { origin: 'file' });
    return L.claimDocument(name, null);
  };

  try {
    setLocale('en');
    // ---- 1. The diff ----
    const same = C.docChanges(site(), site());
    ok('the same document is no change', same.total === 0, String(same.total));
    // An older build's copy of the same network: migrated before it is compared.
    const v1 = site(); delete v1.v; delete v1.networks;
    v1.nodes.forEach((n) => { n.gw = ''; n.dns = ''; n.os = ''; n.ports = ''; n.notes = ''; n.nat = false; });
    const fromOld = C.docChanges(v1, site());
    ok('a baseline from an older build is migrated, not counted device by device', fromOld.devices.changed.length === 0 && fromOld.devices.added.length === 0,
       JSON.stringify(fromOld.devices));

    const ch = C.docChanges(site(), later());
    ok('a device added', ch.devices.added.map((d) => d.name).join() === 'CAM-01', JSON.stringify(ch.devices.added));
    ok('a device removed, named as it was', ch.devices.removed.map((d) => d.name).join() === 'BASELINE-ONLY-7731');
    const pc1 = ch.devices.changed.find((d) => d.id === 'pc1');
    ok('a rename is one device changed, said with its old name', !!pc1 && pc1.renamedFrom === 'PC-1' && pc1.name === 'Recepción', JSON.stringify(pc1));
    ok('and what else changed on it, by the schema’s label', !!pc1 && pc1.fields.join() === 'Gateway', pc1 && pc1.fields.join());
    const pc2 = ch.devices.changed.find((d) => d.id === 'pc2');
    ok('an interface’s address changed and an interface added', !!pc2
       && JSON.stringify(pc2.interfaces) === JSON.stringify([{ name: 'eth0', fields: ['IP / CIDR'] }, { name: 'wlan0', added: true }]), pc2 && JSON.stringify(pc2.interfaces));
    ok('a device only moved is not "changed"', !ch.devices.changed.some((d) => d.id === 'sw'));
    ok('it is counted as moved', ch.devices.moved.map((d) => d.name).join() === 'SW-1', JSON.stringify(ch.devices.moved));
    ok('a cable added and one removed, named by their ends', ch.cables.added.map((c) => c.name).join() === 'SW-1 ↔ CAM-01'
       && ch.cables.removed.map((c) => c.name).join() === 'SW-1 ↔ BASELINE-ONLY-7731', JSON.stringify([ch.cables.added, ch.cables.removed]));
    ok('a relabelled cable is changed, by its label field', ch.cables.changed.length === 1 && ch.cables.changed[0].fields.join() === 'Cable label',
       JSON.stringify(ch.cables.changed));
    ok('a subnet added and one changed', ch.subnets.added.map((s) => s.name).join() === '192.168.50.0/24 · Guest'
       && ch.subnets.changed.length === 1 && ch.subnets.changed[0].fields.join() === 'VLAN', JSON.stringify(ch.subnets));
    ok('a text note counted', ch.notes.added.length === 1);
    ok('an accepted finding counted', ch.accepted.added === 1 && ch.accepted.reopened === 0, JSON.stringify(ch.accepted));
    ok('the report header by field name, not by value', ch.header.join() === 'Reference', ch.header.join());
    // 1 added + 1 removed + 2 changed + 1 moved devices, 1+1+1 cables, 1+1 subnets, 1 note, 1 accepted, 1 header
    ok('the total counts each of them once', ch.total === 13, String(ch.total));
    const back = C.docChanges(later(), site());
    ok('and the other way round, a reopened finding', back.accepted.reopened === 1 && back.devices.added.map((d) => d.name).join() === 'BASELINE-ONLY-7731');

    const rows = C.changeRows(ch);
    ok('the rows read in order: added, removed, changed, moved, then cables', rows.map((r) => r.op).slice(0, 5).join() === 'Added,Removed,Changed,Changed,Moved',
       rows.map((r) => r.op).join());
    const pc1Row = rows.find((r) => r.name === 'Recepción');
    ok('a changed device’s row says the old name and the field', !!pc1Row && pc1Row.detail === 'renamed from PC-1; Gateway', pc1Row && pc1Row.detail);
    const pc2Row = rows.find((r) => r.name === 'PC-2');
    ok('and an interface’s', !!pc2Row && pc2Row.detail === 'eth0: IP / CIDR; wlan0 added', pc2Row && pc2Row.detail);
    ok('the moved row counts them', rows.some((r) => r.op === 'Moved' && r.what === '1 device'));
    ok('a row for the header', rows.some((r) => r.what === 'Report header' && r.detail === 'Reference'));
    // The date is when a report was issued, not the network: the dialog seeds
    // today's into an empty header, and that is no change.
    const dated = site(); dated.report.date = '2026-10-26';
    ok('a report date alone is no change', C.docChanges(site(), dated).total === 0, JSON.stringify(C.docChanges(site(), dated).header));

    // ---- 2. What takes a baseline ----
    persistLibrary({});
    localStorage.removeItem(BINDER_EXPORT_KEY);
    const id = keep(site(), 'Clínica Norte');
    ok('a kept network starts with no baseline', !!id && C.snapshotOf(id) === null);
    downloads = []; exportJsonFile();
    let snap = C.snapshotOf(id);
    ok('Back up this network takes one', !!snap && snap.kind === 'backup', JSON.stringify(snap && snap.kind));
    ok('holding the document as it went out, without its travelling identity', !!snap && snap.doc.id === undefined && snap.doc.updated === undefined
       && JSON.stringify(L.canonicalDoc(snap.doc)) === JSON.stringify(L.canonicalDoc(downloads[0].payload.doc)));
    snap.doc.nodes = [];
    ok('and a caller gets a copy', C.snapshotOf(id).doc.nodes.length === 5);
    ok('the card has nothing to say yet', C.cardChanges(L.libraryEntry(id)).changes.total === 0 && C.cardChangesText(C.cardChanges(L.libraryEntry(id))) === '');

    // Edit the open network the way the editor does: the card follows.
    replaceDocument(later(), { libraryId: id, origin: 'library' });
    save(); flushAutosave();
    // replaceDocument does not write the card; an edit does.
    getNode('pc2').notes = 'moved desk'; save(); flushAutosave();
    const cc = C.cardChanges(L.libraryEntry(id));
    ok('the card now differs from its baseline', !!cc && cc.changes.total === 13, cc && String(cc.changes.total));
    ok('and says so', C.cardChangesText(cc) === '13 changes since the last back-up', C.cardChangesText(cc));

    // ---- 3. The card on the landing ----
    openLanding(false);
    const cardEl = document.querySelector(`#landingCards .landing-card[data-id="${id}"]`);
    const line = cardEl && cardEl.querySelector('.landing-card-changes');
    ok('the landing card shows the line', !!line && line.textContent.includes('13 changes since the last back-up'), line && line.textContent);
    const tool = cardEl && [...cardEl.querySelectorAll('.landing-tool')].find((b) => b.textContent === '±');
    ok('with the list a tool away', !!tool && cardEl.classList.contains('has-changes'));
    let told = null;
    setDialogResponder((req) => { told = req; return undefined; });
    if (tool) { tool.click(); await new Promise((r) => setTimeout(r, 0)); }
    ok('the list names the baseline and every change', !!told && told.kind === 'tell' && told.title === 'Clínica Norte'
       && /^Compared with the back-up of \d{4}-\d{2}-\d{2}\./.test(told.message) && told.message.includes('Removed · Device BASELINE-ONLY-7731')
       && told.message.includes('Changed · Device Recepción — renamed from PC-1; Gateway'), told && told.message);
    setDialogResponder(() => undefined);
    // A card with no baseline, and one with nothing changed, say nothing.
    const other = L.librarySave('Bodega', null, { doc: site() });
    renderLanding();
    const otherEl = document.querySelector(`#landingCards .landing-card[data-id="${other}"]`);
    ok('a card never backed up has no line', !!otherEl && !otherEl.querySelector('.landing-card-changes') && !otherEl.classList.contains('has-changes'));
    // A guest card is never asked: its baseline is not this browser's business.
    C.takeSnapshot('guest-x', 'backup', site());
    setGuestBinder({ sites: [{ id: 'guest-x', name: 'Ajena', doc: later(), updated: 1 }] });
    renderLanding();
    const guestEl = document.querySelector('#guestCards .landing-card');
    ok('a shared card has no line', !!guestEl && !guestEl.querySelector('.landing-card-changes'));
    setGuestBinder(null); C.dropSnapshot('guest-x');
    closeLanding();

    // ---- 4. The report ----
    delivered = [];
    await generateSiteReport();
    let html = delivered[0] || '';
    ok('the report has the section', html.includes('<h2>Changes since the last back-up</h2>'));
    ok('naming the baseline', /Compared with the back-up of \d{4}-\d{2}-\d{2}\./.test(html));
    ok('and the changes, escaped', html.includes('<b>BASELINE-ONLY-7731</b>') && html.includes('renamed from PC-1; Gateway') && html.includes('SW-1 ↔ CAM-01'));
    ok('placed before Scope and method', html.indexOf('Changes since the last back-up') < html.indexOf('Scope and method'));
    snap = C.snapshotOf(id);
    ok('the report is then the baseline', !!snap && snap.kind === 'report' && C.docChanges(snap.doc, serializeDoc()).total === 0);
    delivered = [];
    await generateSiteReport();
    html = delivered[0] || '';
    ok('so the next report says nothing changed since that one', html.includes('<h2>Changes since the last report</h2>') && html.includes('Nothing has changed since then.')
       && /Compared with the report of/.test(html));
    renderLanding();
    ok('and the card is quiet again', C.cardChangesText(C.cardChanges(L.libraryEntry(id))) === '');
    getNode('cam').name = 'CAM-02'; save(); flushAutosave();
    ok('one edit later it says one change since the report', C.cardChangesText(C.cardChanges(L.libraryEntry(id))) === '1 change since the last report',
       C.cardChangesText(C.cardChanges(L.libraryEntry(id))));

    // Through the dialog, the way a visitor gets a report: Open report stores
    // the header with today's date seeded into it before the changes are
    // worked out, and that date must not be reported as a header change.
    ok('the header has no date before the dialog', !state.report.date);
    downloads = []; exportJsonFile();
    getNode('cam').name = 'CAM-03'; save(); flushAutosave();
    openReportDialog('site');
    delivered = [];
    document.getElementById('reportBuildBtn').click();
    for (let i = 0; i < 50 && !delivered.length; i++) await new Promise((r) => setTimeout(r, 10));
    html = delivered[0] || '';
    ok('the dialog stamped today’s date on the header', !!state.report.date);
    ok('the dialog’s report says the rename', html.includes('<h2>Changes since the last back-up</h2>') && html.includes('renamed from CAM-02'));
    ok('and not that the header changed', !html.includes('Report header'));
    ok('nor does the card after it', C.cardChangesText(C.cardChanges(L.libraryEntry(id))) === '');

    // No baseline, no section: byte for byte the sheet without the feature.
    const model = reportModel();
    const plain = reportHtml(model, null);
    ok('without changes the model renders as it did', !plain.includes('Changes since'));
    replaceDocument(templatesData.house, { origin: 'template' });
    delivered = [];
    await generateSiteReport();
    ok('a network that is not kept gets no section', !!delivered[0] && !delivered[0].includes('Changes since'));
    ok('and takes no baseline', C.snapshotOf(state.docId) === null);

    // The binder report: each site's sheet against its card's baseline.
    C.takeSnapshot(other, 'backup', site());
    L.librarySave('Bodega', other, { doc: later() });
    delivered = [];
    await generateBinderReport({}, { images: false });
    html = delivered[0] || '';
    ok('the binder report carries each site’s changes', (html.match(/Changes since the last (back-up|report)/g) || []).length === 2, String((html.match(/Changes since/g) || []).length));
    ok('and every site’s card takes the report as its baseline', C.snapshotOf(other).kind === 'report' && C.snapshotOf(id).kind === 'report');

    // Back up all: every card's baseline, as it went into the file.
    L.librarySave('Bodega', other, { doc: site() });
    downloads = [];
    await exportBinder();
    ok('Back up all takes a baseline for every card', [id, other].every((x) => C.snapshotOf(x) && C.snapshotOf(x).kind === 'backup'));
    ok('each the network as it went in the file', JSON.stringify(L.canonicalDoc(C.snapshotOf(other).doc))
       === JSON.stringify(L.canonicalDoc(downloads[0].payload.sites.find((s) => s.id === other).doc)));

    // Deleting the card drops its baseline.
    L.libraryDelete(other);
    ok('deleting a card drops its baseline', C.snapshotOf(other) === null);

    // ---- 5. Privacy: the baseline never travels ----
    // The old printer lives only in the baselines now.
    C.takeSnapshot(id, 'backup', site());
    replaceDocument(L.libraryEntry(id).doc, { libraryId: id, origin: 'library' });
    ok('the baseline holds the removed device', JSON.stringify(C.snapshotOf(id).doc).includes('BASELINE-ONLY-7731'));
    const MARK = 'BASELINE-ONLY-7731';
    const clean = (label, value) => ok(`${label} carries no baseline`, !JSON.stringify(value).includes(MARK));
    clean('the open document', serializeDoc());
    clean('a document link’s payload', identifiedDoc(serializeDoc()));
    clean('the cards', L.loadLibrary());
    clean('the binder file', L.binderFile());
    clean('a binder link’s payload', L.binderLinkFile().file);
    downloads = []; exportJsonFile();
    clean('the back-up file', downloads[0].payload);
    ok('nothing in localStorage holds it', !Object.keys(localStorage).some((k) => (localStorage.getItem(k) || '').includes(MARK)));
    ok('nor the history entry', !JSON.stringify(window.history.state || {}).includes(MARK));

    // ---- 6. The store ----
    ok('here (no IndexedDB) the baselines are this tab’s', await C.openSnapshotStore() === 'tab');
    const disk = {
      d1: { at: 5, kind: 'backup', doc: { nodes: [], links: [] } },
      d2: { at: 5, kind: 'nonsense', doc: { nodes: [] } },
      d3: 'junk',
      [id]: { at: 1, kind: 'backup', doc: { nodes: [], links: [] } }
    };
    const puts = [], dels = [];
    const fake = {
      readAll: async () => disk,
      read: async (ids) => Object.fromEntries(ids.map((x) => [x, disk[x] || null])),
      put: async (k, rec) => { puts.push(k); disk[k] = rec; return true; },
      del: async (ids) => { dels.push(...ids); ids.forEach((k) => delete disk[k]); return true; }
    };
    ok('a store that answers is adopted', await C.openSnapshotStore(fake) === 'idb');
    await new Promise((r) => setTimeout(r, 0));
    ok('its baselines arrive', !!C.snapshotOf('d1') && C.snapshotOf('d1').at === 5);
    ok('junk is skipped', C.snapshotOf('d2') === null && C.snapshotOf('d3') === null);
    ok('a newer one taken in this tab wins and is written', C.snapshotOf(id).at > 1 && puts.includes(id) && disk[id].at > 1, puts.join());
    ok('with the library on its fallback nothing is pruned', !dels.length && !!C.snapshotOf('d1'));
    puts.length = 0;
    C.takeSnapshot(id, 'report', serializeDoc());
    await new Promise((r) => setTimeout(r, 0));
    ok('a new baseline reaches the store', puts.includes(id) && disk[id].kind === 'report');
    C.dropSnapshot('d1');
    await new Promise((r) => setTimeout(r, 0));
    ok('a dropped one leaves it', dels.includes('d1') && !('d1' in disk));
    C.releaseSnapshotStore();

    // ---- 7. Spanish ----
    setLocale('es');
    const es = C.changeRows(C.docChanges(site(), later()));
    ok('the rows in Spanish', es.some((r) => r.op === 'Añadido' && r.what === 'Dispositivo' && r.name === 'CAM-01')
       && es.some((r) => r.detail.startsWith('antes se llamaba PC-1')), JSON.stringify(es.slice(0, 3)));
    ok('the card line in Spanish', C.cardChangesText({ snap: { kind: 'backup' }, changes: { total: 3 } }) === '3 cambios desde el último respaldo');
    ok('the section in Spanish', C.changesSection({ at: Date.now(), kind: 'report', rows: [] }).includes('Comparado con el informe del'));
    ok('a field label stays the technical term', es.some((r) => r.name === 'PC-2' && r.detail.includes('IP / CIDR')));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    setLocale(heldLocale);
    window.downloadJson = realDownload; window.deliverReport = realDeliver; window.captureCanvasImage = realCapture;
    setDialogResponder(heldResponder);
    persistLibrary(heldLib);
    held.forEach(([k, v]) => { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); });
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
