// @realtime @touch 360x740
// Import… (js/importui.js, js/importers/registry.js; docs/SCOPE.md step 6,
// D114, D115, D118). Covered:
//   - detection: every fixture picks its importer and no fixture is claimed
//     by two; Topo's own files keep their doors (a network .json opens as a
//     network, Topo's spreadsheets go to Spreadsheet); a UniFi .unf and a
//     binary Omada .cfg are refused with a sentence; an unknown file asks
//     for its format (the manual picker);
//   - the dialog: one card per file with its format and "Not right?"; the
//     "What was understood" step with counts, at most 50 warnings then
//     "and N more", the notes; the three targets;
//   - Continue merges as a copy: the review is asked (setMergeResponder),
//     the source and reason are the files', a restore point is taken, the
//     log names the files, one undo step takes it back, nothing is deleted;
//   - Open as its own network: a new card, named after the site, no
//     transient id left;
//   - the landing's open/drop door: a CSV or a NetBox page that is not a
//     Topo file opens Import… pre-filled instead of failing;
//   - every warning and note code has a sentence, and it is translated;
//   - the menu items, and the dialog in steps 1 and 2 on a phone (360 and
//     390: 44px targets, 16px fields, no sideways scroll);
//   - no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const until = async (cond, n = 150) => { for (let i = 0; i < n && !(await cond()); i++) await wait(30); return cond(); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const enc = (name, text) => ({ name, text, bytes: new TextEncoder().encode(text) });
  const fetchFile = async (path) => enc(path.split('/').pop(), await (await fetch(path)).text());
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const audit = async (label) => {
    await settle();
    const r = window.touchAudit(label);
    const lines = r.lines.filter((l) => !/^screen not reached/.test(l));
    ok(`${label} @${innerWidth}: 44px targets, 16px fields, nothing past the edge`, !lines.length && r.measured > 0, lines.slice(0, 6).join(' | '));
    ok(`${label} @${innerWidth}: no sideways scroll`, document.documentElement.scrollWidth <= innerWidth);
  };
  const I = TopoImporters, U = TopoImportUI, R = CarinoRestore, MU = TopoMergeUI, TM = TopoMerge;
  const heldDigest = TM.setDigest(async (text) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, '0').repeat(8);
  });
  const reviews = [];
  let reviewAnswer = {};
  const heldMerge = MU.setMergeResponder((req) => { reviews.push(req); return reviewAnswer; });
  let pickId = null;
  setDialogResponder((q) => (q.kind === 'pick' ? pickId : q.kind === 'confirm' ? true : q.kind === 'choice' ? null : undefined));
  try {
    await window.__media('reduce');
    await loadScript('tests/fixtures/touchaudit.js');
    await R.openRestoreStore({ open: async () => [], readCards: async (ids) => { const o = {}; ids.forEach((id) => { o[id] = []; }); return o; }, readDoc: async () => null, write: async () => true });

    // ---- Detection ----
    const nbFiles = [];
    for (const dir of ['csv-verbose', 'csv-fields', 'api']) {
      const names = { 'csv-verbose': ['devices.csv', 'interfaces.csv', 'cables.csv', 'ip-addresses.csv', 'prefixes.csv', 'vlans.csv', 'locations.csv', 'racks.csv'],
        'csv-fields': ['devices.csv', 'interfaces.csv', 'mac-addresses.csv', 'virtual-machines.csv', 'vm-interfaces.csv', 'wireless-lans.csv', 'ip-addresses.csv'],
        api: ['devices.json', 'interfaces.json', 'mac-addresses.json', 'cables.json', 'ip-addresses.json', 'prefixes.json', 'vlans.json', 'locations.json', 'wireless-lans.json'] }[dir];
      for (const n of names) nbFiles.push(Object.assign(await fetchFile(`tests/fixtures/import/netbox/${dir}/${n}`), { dir }));
    }
    const claims = nbFiles.map((f) => ({ f, by: I.list().filter((imp) => imp.detect(f) > 0.5).map((imp) => imp.id) }));
    ok('every fixture is claimed by its importer and by no other', claims.every((c) => c.by.length === 1 && c.by[0] === 'netbox'), claims.filter((c) => c.by.length !== 1).map((c) => `${c.f.dir}/${c.f.name}:${c.by}`).join(' '));
    const topoJson = enc('topo_acme_2026-11-10.json', JSON.stringify(withTopoSchema({ kind: 'nettopology', version: 1, name: 'Acme', doc: canonicalDoc(templatesData.house) })));
    ok('a Topo network file keeps its door', I.sniff(topoJson).kind === 'topo');
    const sheets = CSV_SHEETS.map((s) => ({ key: s.key, f: enc(`${s.key}.csv`, csvText(s.build())) }));
    const sheetKinds = sheets.map((s) => `${s.key}:${I.sniff(s.f).kind}`);
    ok('Topo\'s own spreadsheets go to Spreadsheet, never to an importer', sheets.every((s) => I.sniff(s.f).kind === 'topo-csv' || !s.f.text.trim().includes('\n')), sheetKinds.join(' '));
    const unf = { name: 'autobackup_9.0.114.unf', bytes: new Uint8Array([0x9a, 0x01, 0x00, 0xff, 0x13, 0x00]), text: '' };
    const cfg = { name: 'omada_backup.cfg', bytes: new Uint8Array(200).map((_, i) => (i * 37) % 256), text: '' };
    ok('a UniFi .unf and a binary Omada .cfg are refused, each with its reason', I.sniff(unf).kind === 'refused' && I.sniff(unf).reason === 'unifi-backup'
      && I.sniff(cfg).kind === 'refused' && I.sniff(cfg).reason === 'omada-backup');
    const odd = enc('stuff.csv', 'alpha,beta\n1,2\n');
    ok('a file nothing recognises asks for its format', I.sniff(odd).kind === 'unknown');

    // ---- The menu ----
    ok('Import… and Export to NetBox… are in the Export menu', !!el('importAnyBtn') && el('exportMenu').contains(el('importAnyBtn')) && el('exportMenu').contains(el('exportNetboxBtn')));

    // ---- Step 1: the files ----
    persistLibrary({ k1: { id: 'k1', name: 'Casa', doc: clone(canonicalDoc(templatesData.house)), created: 1, updated: Date.now() - 1000 } });
    replaceDocument(libraryEntry('k1').doc, { libraryId: 'k1', origin: 'library' });
    const targetId = state.libraryId;
    ok('the open network is kept (a merge target)', !!targetId && isKept());
    const verbose = nbFiles.filter((f) => f.dir === 'csv-verbose');
    el('importAnyBtn').click();
    await until(() => !el('importDialog').hidden);
    ok('Import… opens the dialog, empty, Read the files off', !el('importDialog').hidden && el('importNextBtn').disabled && !!el('importChooseBtn'));
    await U.addFiles(verbose.concat([unf, odd, topoJson]));
    await settle();
    const cards = [...el('importBody').querySelectorAll('.imp-file')];
    ok('one card per file, with what it was read as', cards.length === verbose.length + 3 && /Read as NetBox/.test(cards[0].textContent));
    ok('the refused backup says why', /locked file/.test(cards[verbose.length].textContent) && cards[verbose.length].classList.contains('refused'));
    ok('an unknown file asks: Not right? with every importer and "Leave it out"', /Not recognised/.test(cards[verbose.length + 1].textContent)
      && [...cards[verbose.length + 1].querySelectorAll('option')].map((o) => o.value).join() === ',' + I.list().map((x) => x.id).join());
    ok('a Topo file in the set is offered to open as a network', /A Topo file/.test(cards[verbose.length + 2].textContent) && !!cards[verbose.length + 2].querySelector('[data-imp-open]'));
    ok('selects are 16px', [...el('importBody').querySelectorAll('select')].every((s) => parseFloat(getComputedStyle(s).fontSize) >= 16));
    for (const w of [360, 390]) { await window.__viewport(w, w === 360 ? 740 : 844); await audit('Import step 1'); }
    // The manual picker: the unknown file left out stays out.
    ok('Read the files is on', !el('importNextBtn').disabled);

    // ---- Step 2: what was understood ----
    el('importNextBtn').click();
    await settle();
    const body = () => el('importBody').textContent;
    const st = U._state();
    ok('one result, NetBox, from the eight files', st.step === 2 && st.results.length === 1 && st.results[0].files.length === verbose.length);
    ok('counts', /4\s*Devices/.test(body()) && /3\s*Cables/.test(body()) && /3\s*Subnets/.test(body()) && /1\s*Racks/.test(body()), body().slice(0, 300));
    ok('what could not be read, by file and row', /devices\.csv, row 6: no name, left out\./.test(body()) && /192\.168\.10\.250\/24 is on no interface/.test(body()), body().slice(0, 900));
    ok('the notes', /VLAN 30 has no subnet: it stays on its ports\./.test(body()));
    ok('three targets, the open network first and chosen', [...el('importBody').querySelectorAll('input[name="impTarget"]')].map((r) => r.value).join() === 'here,other,new'
      && el('importBody').querySelector('input[value="here"]').checked);
    ok('it says importing never deletes', /it never deletes/.test(body()));
    for (const w of [360, 390]) { await window.__viewport(w, w === 360 ? 740 : 844); await audit('Import step 2'); }
    await window.__viewport(1280, 900);

    // ---- Continue: the merge ----
    reviews.length = 0; reviewAnswer = {};
    const before = serializeDoc();
    const beforeNames = before.nodes.map((n) => n.name).sort().join();
    const res = await U.continueImport();
    await settle();
    ok('the review was asked, two-way, named by the files', reviews.length === 1 && reviews[0].plan.mode === 'two-way' && /^NetBox: devices\.csv, interfaces\.csv/.test(reviews[0].sourceText), reviews[0] && reviews[0].sourceText);
    ok('merged into the open network: added, nothing of it deleted', res.length === 1 && res[0] && res[0].ok !== false && state.libraryId === targetId
      && before.nodes.every((n) => state.nodes.some((m) => m.id === n.id)) && state.nodes.some((n) => n.name === 'core-sw-01'));
    ok('no transient id in the network', !/"imp-/.test(JSON.stringify(serializeDoc())));
    const pts = R.restorePointsOf(targetId);
    ok('a restore point first, named after the import', pts.length >= 1 && /^Before importing NetBox: devices\.csv/.test(R.restoreReasonText(pts[pts.length - 1])), pts.length && R.restoreReasonText(pts[pts.length - 1]));
    const log = (libraryEntry(targetId).doc.log || []).slice(-1)[0];
    ok('the log names the files', !!log && /^NetBox: devices\.csv/.test(log.source), JSON.stringify(log));
    undo(); flushAutosave();
    ok('one undo step takes the import back', state.nodes.map((n) => n.name).sort().join() === beforeNames);

    // ---- Open as its own network ----
    await U.openImport(nbFiles.filter((f) => f.dir === 'api'));
    U.readFiles();
    await settle();
    el('importBody').querySelector('input[value="new"]').click();
    await U.continueImport();
    await settle();
    const own = libraryEntries().find((e) => e.name === 'Hotel Mar');
    ok('opened as its own network, named after the site', !!own && state.libraryId === own.id, libraryEntries().map((e) => e.name).join());
    ok('with no transient ids', !!own && !/"imp-/.test(JSON.stringify(own.doc)) && own.doc.nodes.some((n) => n.name === 'sw-floor2'));

    // ---- Merge into another… ----
    await U.openImport(nbFiles.filter((f) => f.dir === 'csv-fields'));
    U.readFiles(); await settle();
    el('importBody').querySelector('input[value="other"]').click();
    pickId = targetId; reviews.length = 0;
    await U.continueImport(); await settle();
    ok('Merge into another network… asks which, then reviews into it', reviews.length === 1 && reviews[0].targetId === targetId && libraryEntry(targetId).doc.nodes.some((n) => n.name === 'ris-01'));

    // ---- A label with "/" keeps its whole name in the review and the log ----
    // (the merge keeps a source's last path part: "MAC table: …" was the title).
    {
      const cdp = await fetchFile('tests/fixtures/import/cisco-cdp.txt');
      await U.openImport([cdp]);
      U.readFiles(); await settle();
      el('importBody').querySelector('input[value="here"]').click();
      reviews.length = 0;
      await U.continueImport(); await settle();
      ok('a Cisco import is named in full in the review', reviews.length === 1 && /^Cisco CDP . MAC table: cisco-cdp\.txt$/.test(reviews[0].sourceText), reviews[0] && reviews[0].sourceText);
      const last = (libraryEntry(targetId).doc.log || []).slice(-1)[0];
      ok('and in the network log', !!last && /^Cisco CDP . MAC table: cisco-cdp\.txt$/.test(last.source), last && last.source);
      ok('port names read as names in the review, not JSON', MU.mergeValueText('nodes', 'portScheme', { prefix: 'GigabitEthernet', start: 1 }) === 'GigabitEthernet1, GigabitEthernet2, …');
    }

    // ---- The landing door ----
    const csvFile = new File([verbose[0].text], 'devices.csv', { type: 'text/csv' });
    importJsonFile(csvFile);
    ok('a CSV opened with Open a file goes to Import…, pre-filled', await until(() => !el('importDialog').hidden && (U._state() || { files: [] }).files.length === 1));
    U.closeImportDialog();
    const page = nbFiles.find((f) => f.dir === 'api' && f.name === 'devices.json');
    importJsonFile(new File([page.text], 'devices.json', { type: 'application/json' }));
    ok('so does a NetBox API page, which is JSON but not Topo\'s', await until(() => !el('importDialog').hidden && (U._state() || { files: [] }).files.length === 1 && U._state().files[0].sniff.importer === 'netbox'));
    U.closeImportDialog();

    // ---- Warnings capped at 50 ----
    {
      const rows = ['address,status,device,interface,dns_name'].concat(Array.from({ length: 60 }, (_, i) => `10.9.0.${i + 1}/24,active,,`)).join('\n');
      await U.openImport([enc('ip-addresses.csv', rows), enc('devices.csv', 'name,role,device_type,manufacturer,site,status\nx1,Server,Box,Acme,S,active\n')]);
      U.readFiles(); await settle();
      const items = el('importBody').querySelectorAll('.imp-warns li');
      ok('60 warnings show the first 50, then "and 10 more"', items.length === 51 && /and 10 more/.test(items[50].textContent), String(items.length));
      U.closeImportDialog();
    }

    // ---- Stage 6 formats in the dialog: the ticks and the switch name ----
    {
      // An empty network behind the dialog: the audit below is of the dialog,
      // not of a map left panned by the imports above.
      replaceDocument(canonicalDoc({ nodes: [], links: [] }), { origin: 'file' });
      const uf = await Promise.all(['unifi/device.json', 'unifi/sta.json', 'unifi/networkconf.json', 'unifi/wlanconf.json'].map((p) => fetchFile(`tests/fixtures/import/${p}`)));
      const cdp = await fetchFile('tests/fixtures/import/cisco-mac-nxos.txt');
      const xml = await fetchFile('tests/fixtures/import/nmap-basic.xml');
      await U.openImport(uf.concat([cdp, xml]));
      await settle();
      const kinds = U._state().files.map((f) => f.choice).join();
      ok('UniFi, Cisco and nmap files each find their importer', kinds === 'unifi,unifi,unifi,unifi,cisco,nmap', kinds);
      U.readFiles(); await settle();
      const ticks = [...el('importBody').querySelectorAll('[data-imp-part]')];
      const wired = ticks.find((c) => /:wired$/.test(c.dataset.impPart)), wless = ticks.find((c) => /:wireless$/.test(c.dataset.impPart));
      ok('clients come with ticks: wired on, wireless off, with their counts', wired && wired.checked && wless && !wless.checked
        && /Clients \(wireless\) \(2\)/.test(el('importBody').textContent), el('importBody').textContent.slice(0, 400));
      const uRes = () => U._state().results.find((r) => r.importer === 'unifi');
      const before2 = uRes().counts.devices;
      wless.click(); await settle();
      ok('ticking wireless clients adds them to what is imported', uRes().counts.devices === before2 + 2 && uRes().doc.nodes.some((n) => n.name === 'iPhone-de-Ana'));
      const name = el('importBody').querySelector('[data-imp-name]');
      ok('a capture with no prompt asks for the switch\'s name', !!name && /This switch's name/.test(el('importBody').textContent));
      name.value = 'LEAF-01';
      name.dispatchEvent(new Event('change'));
      await settle();
      const cRes = U._state().results.find((r) => r.importer === 'cisco');
      ok('the name given renames the switch, the ticks keep their state', cRes.doc.nodes.some((n) => n.name === 'LEAF-01') && uRes().parts.find((p) => p.key === 'wireless').on);
      for (const w of [360, 390]) { await window.__viewport(w, w === 360 ? 740 : 844); await audit('Import step 2, ticks and name'); }
      await window.__viewport(1280, 900);
      el('importBody').querySelector('input[value="new"]').click();
      const made = await U.continueImport(); await settle();
      ok('three formats, three networks of their own', made.length === 3, String(made.length));
      U.closeImportDialog();
      const xmlFile = new File([xml.text], 'scan.xml', { type: 'application/xml' });
      importJsonFile(xmlFile);
      ok('an nmap .xml opened with Open a file goes to Import…, read as nmap', await until(() => !el('importDialog').hidden && (U._state() || { files: [] }).files.length === 1 && U._state().files[0].choice === 'nmap'));
      U.closeImportDialog();
    }

    // ---- Every code has a sentence, translated ----
    const codes = Object.keys(U.WARN_TEXT).concat(Object.keys(U.NOTE_TEXT));
    const strings = Object.values(U.WARN_TEXT).concat(Object.values(U.NOTE_TEXT), Object.values(U.REFUSED_TEXT), U.COUNT_LABELS.map((c) => c[1]), Object.values(U.PART_LABELS),
      ['Include', 'This switch\'s name', 'As its prompt shows it']);
    ok('the codes the other importers give all have a sentence', ['bad-xml', 'host-no-address', 'hosts-down', 'api-error', 'uplink-unknown', 'no-mac', 'sections-not-read', 'uplinks-skipped',
      'port-two-vlans', 'dates-ambiguous', 'line-unread', 'no-address', 'no-prefix', 'secrets', 'iface-disabled', 'ip-extra'].every((c) => codes.includes(c)));
    const loc = CarinoI18N.locales.filter((l) => l !== 'en');
    const missing = [];
    loc.forEach((l) => strings.forEach((s) => { if (!CarinoI18N.has(l, s)) missing.push(`${l}: ${s.slice(0, 40)}`); }));
    ok('every warning, note, refusal and count label is translated', !missing.length, `${missing.length}: ${missing.slice(0, 3).join(' | ')}`);
    ok('the codes the NetBox importer gives all have a sentence', ['row-no-name', 'iface-no-device', 'ip-unassigned', 'ip-extra', 'cable-end', 'cable-not-iface', 'vlan-no-subnet',
      'secrets', 'not-read', 'columns-not-read', 'iface-disabled', 'vm-no-host', 'rack-width', 'file-unknown', 'prefix-bad', 'ip-bad', 'columns-max'].every((c) => codes.includes(c)));
    setLocale('es');
    ok('in Spanish', /fila 6/.test(U.issueText({ code: 'row-no-name', file: 'devices.csv', row: 6 })) && /VLAN 30/.test(U.issueText({ code: 'vlan-no-subnet', params: { vid: 30 } })),
      U.issueText({ code: 'row-no-name', file: 'devices.csv', row: 6 }));
    setLocale('ja');
    ok('Japanese says PC, never パソコン', !strings.map((s) => t(s)).join('').includes('パソコン'));
    setLocale('en');
    ok('no console error', !errors.length, errors.slice(0, 3).join(' | '));
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  }
  MU.setMergeResponder(heldMerge);
  TM.setDigest(heldDigest);
  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
