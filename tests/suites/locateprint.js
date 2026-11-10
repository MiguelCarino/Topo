// Locate stage 5 (docs/BACKLOG.md, feature 1, landing order step 4): the
// print sheet (locateRows / locateHtml / printLocate, js/locate.js). What is
// held (tests part 8):
//   - one self-contained page, one block per device (name, asset tag,
//     address, MAC), by name, under the network's name and the date;
//   - every step (NIC, cable with its facts, the via byte for byte, far port
//     with jack and VLAN, rack units, the group path) and every gap and stop
//     of every cable, worded as the section words them; Pick a port is a
//     button in the section, never printed;
//   - nothing fetched: no src, no href, no stylesheet link, no @import or
//     url(), no outside address (as the labels sheet is held, assets suite);
//   - the print styles: black on white whatever the screen theme, the
//     toolbar hidden, a block never split across pages; a dark screen theme;
//   - reachable from the Locate section (one device) and from the rail for a
//     selection holding devices (hidden for a set of cables, gone in the
//     reduced views); a set with no device prints nothing and says why;
//   - shown first like the labels (js/sheetpreview.js): no tab, no
//     download until the preview's Download (named -locate-) or Print;
//   - no edit and no undo step; Spanish; the strings in es, pt-BR, ja, ru;
//   - a 300-device selection's rows in one lookup pass.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const gone = (id) => el(id).classList.contains('hidden') || getComputedStyle(el(id)).display === 'none' || el(id).offsetParent === null;
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const NIC = (...names) => names.map((name, k) => ({ id: `e${k + 1}`, name, ip: '' }));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: NIC('eth0') }, extra);
  const L = (id, source, sourceIface, target, targetIface, extra = {}) => Object.assign({ id, source, target, sourceIface, targetIface }, extra);
  const VIA = 'PP-A:12  >  WJ-3B';
  const doc = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw1', 'switch', { name: 'Office switch', group: 'rk', rackU: 40, interfaces: [], portCount: 24,
        portAttrs: { p3: { label: 'Reception 2', vlan: 10 } } }),
      N('pc', 'pc', { name: 'Front desk', group: 'rec', assetTag: 'CS-0900',
        interfaces: [{ id: 'e1', name: 'eth0', ip: '10.0.0.21/24', mac: '3c0754112233' }] }),
      N('np', 'pc', { name: 'No port PC', group: 'rec' }),
      N('zed', 'pc', { name: 'Zed PC', group: 'rec' }),
      N('sw3', 'switch', { name: 'Unplaced switch', group: 'rk', interfaces: [], portCount: 8 }),
      N('sw2', 'switch', { name: 'Desk switch', interfaces: [], portCount: 8, location: 'Under the desk' }),
      N('lone', 'pc', { name: 'Lone PC', group: 'rec' }),
      N('tv', 'pc', { name: 'Living TV', group: 'rec', interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }),
      N('ap1', 'ap', { name: 'Living AP', group: 'rec', interfaces: [], status: 'retired' }),
      N('hst', 'server', { name: 'HST', group: 'rk', rackU: 20 }),
      N('vm', 'vm', { name: 'VM-9', host: 'hst', interfaces: [{ id: 'v1', name: 'eth0', ip: '' }] }),
      // Two cables (a bond): two legs. A PC on a router: a routing stop. A
      // fork with no faceplate: a several stop.
      N('srv', 'server', { name: 'SRV', group: 'rk', rackU: 10,
        interfaces: [...NIC('eno1', 'eno2'), { id: 'b0', name: 'bond0', ip: '10.0.0.5/24', bond: { mode: '802.3ad', members: ['e1', 'e2'] } }] }),
      N('rt', 'router', { name: 'RT', group: 'rec' }),
      N('rp', 'pc', { name: 'RP', group: 'rec' }),
      N('y1', 'pc', { name: 'Y1', group: 'rec' }),
      N('y2', 'pc', { name: 'Y2', group: 'rec', interfaces: NIC('a', 'b', 'c') }),
      N('y3', 'pc', { name: 'Y3', group: 'rec' }),
      N('y4', 'pc', { name: 'Y4', group: 'rec' })
    ],
    links: [
      L('c1', 'pc', 'e1', 'sw1', 'p3', { cable: { label: 'A-01', color: 'blue', length: '3 m', via: VIA } }),
      L('c3', 'np', 'e1', 'sw2', null),
      L('c7', 'zed', 'e1', 'sw3', 'p2'),
      L('c4', 'tv', 'w1', 'ap1', null, { medium: 'wireless', wifi: { band: '5' } }),
      L('c5', 'ap1', 'p1', 'sw1', 'p4'),
      L('c6', 'hst', 'e1', 'sw1', 'p6'),
      L('c8', 'srv', 'e1', 'sw1', 'p8', { cable: { label: 'B-01' } }),
      L('c9', 'srv', 'e2', 'sw1', 'p9', { cable: { label: 'B-02' } }),
      L('r1', 'rp', 'e1', 'rt', 'e1'),
      L('y12', 'y1', 'e1', 'y2', 'e1'), L('y23', 'y2', 'e2', 'y3', 'e1'), L('y24', 'y2', 'e3', 'y4', 'e1')
    ],
    groups: [{ id: 'bld', name: 'HQ', kind: 'building' }, { id: 'room', name: 'Server room', kind: 'room', parent: 'bld' },
      { id: 'rk', name: 'Rack S', kind: 'rack', parent: 'room', uHeight: 42 }, { id: 'rec', name: 'Reception', kind: 'room', parent: 'bld' }] });
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
  const heldOpen = window.open;
  const heldProfile = { profile: state.settings.profile, advanced: state.settings.advanced };
  const reduce = (profile) => { state.settings.profile = profile; state.settings.advanced = false; applyProfile(); };
  // window.open stubbed: the sheet's blob read back, no tab opened.
  let opened = [];
  // The blob is caught as it is made (a fetch of a blob: address is refused
  // by the page's CSP).
  const blobs = new Map(), heldURL = URL.createObjectURL;
  URL.createObjectURL = function (b) { const u = heldURL.call(URL, b); blobs.set(u, b); return u; };
  const capture = () => { opened = []; window.open = (url) => { opened.push(url); return { addEventListener() {} }; }; };
  setLocale('en');

  try {
    replaceDocument(doc(), { origin: 'file' });
    setView('map');
    const before = JSON.stringify(serializeDoc()), stepsBefore = steps();

    // ---- The sheet for a selection ----
    const entries = ['vm', 'pc', 'np', 'tv', 'lone', 'zed', 'srv', 'rp', 'y1'].map((id) => ({ type: 'node', id })).concat([{ type: 'link', id: 'c1' }]);
    const rows = locateRows(entries);
    ok('one row per selected device, by name; a cable in the set is no row',
      rows.map((r) => r.node.id).join(',') === 'pc,tv,lone,np,rp,srv,vm,y1,zed', rows.map((r) => r.node.id).join(','));
    const html = locateHtml(rows, { site: 'Clinic HQ', date: '2026-11-04' });
    const sheet = parse(html);
    const text = sheet.body.textContent;
    ok('a whole page with its own title', /^<!doctype html>/i.test(html) && sheet.title === 'Where they are plugged in');
    ok('under the network\'s name and the date', sheet.querySelector('header').textContent.includes('Clinic HQ · 2026-11-04'));
    const blocks = [...sheet.querySelectorAll('.dev-block')];
    ok('one block per device, in the rows\' order', blocks.length === rows.length
      && blocks.every((b, k) => b.querySelector('h2').textContent === rows[k].node.name), blocks.map((b) => b.querySelector('h2').textContent).join(','));
    const blockOf = (id) => blocks[rows.findIndex((r) => r.node.id === id)];
    ok('the block names the asset tag, the address and the MAC', /Asset tag CS-0900/.test(blockOf('pc').textContent)
      && blockOf('pc').textContent.includes('10.0.0.21/24') && blockOf('pc').textContent.includes('3C:07:54:11:22:33'), blockOf('pc').querySelector('.facts') && blockOf('pc').querySelector('.facts').textContent);
    // Every step of every hop, and every gap and stop, as the section words
    // them: each block's rows (the leg headings and every li), in order and
    // each one's text exactly, against what the path holds.
    const missing = [];
    let gapsWanted = 0, stopsWanted = 0;
    rows.forEach(({ node, path }, b) => {
      const want = [];
      const gapT = (g) => { const hop = g.hop >= 0 ? path.legs[g.leg].hops[g.hop] : null; gapsWanted++;
        return locateGapText(g, hop) + (g.code === 'notGrouped' && g.text ? ` ${t('Location typed on it: {text}', { text: g.text })}` : ''); };
      const gapsOf = (l, k) => path.gaps.filter((g) => g.leg === l && g.hop === k).map(gapT);
      const devT = (n, port, extra, retired) => (port ? `${n.name} · ${port}` : n.name) + (extra ? ` ${extra}` : '') + (retired ? ' (Retired)' : '');
      path.start.hosts.forEach((h) => want.push(`Runs on ${h.name}`));
      want.push(...gapsOf(-1, -1));
      path.legs.forEach((leg, l) => {
        if (path.legs.length > 1) want.push(`Cable ${l + 1} of ${path.legs.length}`);
        leg.hops.forEach((h, k) => {
          const f = locateHopFacts(h);
          want.push(devT(h.from, f.nic, '', isRetired(h.from)));
          want.push(f.main + (f.meta.length ? ` ${f.meta.join(' · ')}` : '') + (f.via ? `Via: ${f.via}` : ''));
          want.push(devT(h.far, h.farPort, f.jack, h.retired));
          if (h.place.rack && h.place.units) want.push(`${h.place.rack.name} · ${h.place.units}`);
          if (h.place.groups.length) want.push(h.place.groups.map((g) => `${groupKindName(g.kind)} ${g.name}`).join(' › '));
          want.push(...gapsOf(l, k));
        });
        const stop = locateStopText(leg);
        if (stop) { want.push(stop); gapsWanted++; stopsWanted++; }
      });
      const got = [...blocks[b].querySelectorAll('.leg, .steps > li')].map((x) => x.textContent);
      if (got.join('\n') !== want.join('\n')) missing.push(`${node.id}: got [${got.join(' | ')}] want [${want.join(' | ')}]`);
    });
    ok('every step and every gap of every cable is printed, row by row', missing.length === 0, missing.join(' || '));
    ok('one gap line per gap and stop, no more (and stops are held here)', sheet.querySelectorAll('.gap').length === gapsWanted && stopsWanted >= 2,
      `${sheet.querySelectorAll('.gap').length}/${gapsWanted}, ${stopsWanted} stops`);
    ok('two cables: two legs, each headed', /Cable 1 of 2/.test(blockOf('srv').textContent) && /Cable 2 of 2/.test(blockOf('srv').textContent)
      && blockOf('srv').querySelectorAll('.leg').length === 2 && /SRV · eno1 \(bond0\)/.test(blockOf('srv').textContent), blockOf('srv').textContent);
    ok('the stops, worded as the section words them', [...blockOf('rp').querySelectorAll('.gap')].some((g) => g.textContent === 'Stops at RT, a routing device.')
      && [...blockOf('y1').querySelectorAll('.gap')].some((g) => g.textContent === 'More than one cable leads on from Y2: which one is not recorded.'),
      blockOf('rp').textContent + ' / ' + blockOf('y1').textContent);
    const codes = new Set(rows.flatMap((r) => r.path.gaps.map((g) => g.code)));
    ok('the gaps held here: noCable, noPort, noJack, noVia, notGrouped, notPlaced, retired', ['noCable', 'noPort', 'noJack', 'noVia', 'notGrouped', 'notPlaced', 'retired'].every((c) => codes.has(c)), [...codes].join(','));
    ok('the via byte for byte, never split or trimmed', [...sheet.querySelectorAll('.via .mono')].some((m) => m.textContent === VIA));
    ok('the cable\'s tag, colour and length, the jack and VLAN', /Tag: A-01/.test(blockOf('pc').textContent) && /blue · 3 m/.test(blockOf('pc').textContent)
      && /Office switch · 3/.test(blockOf('pc').textContent) && /Jack Reception 2 · VLAN 10/.test(blockOf('pc').textContent), blockOf('pc').textContent);
    ok('the group path with each kind', /Building HQ › Room Server room › Rack Rack S/.test(text.replace(/\s+/g, ' ')), text.slice(0, 400));
    ok('a VM: runs on its host, then the host\'s cable; the switch\'s rack units', /Runs on HST/.test(blockOf('vm').textContent) && /HST · eth0/.test(blockOf('vm').textContent)
      && /Rack S · U40/.test(blockOf('vm').textContent), blockOf('vm').textContent);
    ok('the typed location, as typed', /Location typed on it: Under the desk/.test(blockOf('np').textContent), blockOf('np').textContent);
    ok('no port picked: said, never read as port 1, and no Pick a port button on paper',
      /No port picked at Desk switch\./.test(blockOf('np').textContent) && !/Desk switch · 1\b/.test(blockOf('np').textContent) && !sheet.querySelector('button:not(.toolbar button)') && !/Pick a port/.test(text));
    ok('Wi-Fi: the band, then the AP\'s cable to the switch; the retired AP marked', /5 GHz/.test(blockOf('tv').textContent) && /Living AP · 1/.test(blockOf('tv').textContent)
      && /Office switch · 4/.test(blockOf('tv').textContent) && /Living AP is retired\./.test(blockOf('tv').textContent) && !!blockOf('tv').querySelector('.dev.retired'), blockOf('tv').textContent);
    ok('nothing recorded: said', /No cable recorded\./.test(blockOf('lone').textContent));
    // Nothing fetched: the labels sheet's assertion, and no outside address at all.
    ok('the sheet fetches nothing (no src, no href, no stylesheet link)', !sheet.querySelector('[src], link, a[href]') && !/@import|url\(/.test(html));
    ok('and holds no outside address', !/(https?:)?\/\/[a-z0-9]/i.test(html.replace(/<!doctype html>/i, '')), (html.match(/(https?:)?\/\/[a-z0-9][^"' ]*/i) || [''])[0]);
    const css = sheet.querySelector('style').textContent;
    const printCss = (css.match(/@media print \{([\s\S]*?)\n\}/) || [])[1] || '';
    ok('print: black on white whatever the screen theme, the toolbar hidden', /body \{[^}]*background: #fff;[^}]*color: #000;/.test(printCss) && /\.toolbar \{ display: none; \}/.test(printCss) && /color-scheme: light/.test(printCss), printCss);
    ok('a device block is never split across pages', /\.dev-block \{[^}]*break-inside: avoid/.test(css));
    ok('on screen it follows a dark theme too', /@media \(prefers-color-scheme: dark\)/.test(css));
    // Laid out: it wraps, a phone-wide frame never scrolls sideways.
    {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;left:0;top:0;width:360px;height:600px;border:0;visibility:hidden';
      const d0 = doc(); d0.links[0].cable.via = 'PP-A:12 > WJ-3B > a very long run through the ceiling of the east wing towards the server room, ' + 'x'.repeat(80);
      replaceDocument(d0, { origin: 'file' });
      f.srcdoc = locateHtml(locateRows([{ type: 'node', id: 'pc' }]), { site: 'S', date: '2026-11-04' });
      document.body.appendChild(f);
      await new Promise((r) => { f.onload = r; setTimeout(r, 1500); });
      const fd = f.contentDocument, de = fd && fd.documentElement;
      const via = fd && fd.querySelector('.dev-block .via');
      ok('the 360px frame holds the sheet with the long via', !!via && via.textContent.includes('a very long run through the ceiling') && de.clientWidth === 360, via ? via.textContent : 'no sheet in the frame');
      ok('at 360px a long via wraps, no horizontal scroll', !!via && de.scrollWidth <= 360, de && de.scrollWidth);
      f.remove();
      replaceDocument(doc(), { origin: 'file' });
    }

    // ---- The rail: a set holding devices ----
    selectEntries(['pc', 'np', 'tv'].map((id) => ({ type: 'node', id })));
    ok('the rail offers Print where they are plugged in for several devices', !gone('printLocateBtn') && el('printLocateBtn').textContent.trim() === 'Print where they are plugged in');
    capture();
    el('printLocateBtn').click();
    ok('the click previews the sheet: no tab opened', opened.length === 0 && !!sheetPreviewBuilt() && !el('sheetPreviewDialog').classList.contains('hidden'), opened.join(','));
    if (sheetPreviewBuilt()) {
      const got = parse(sheetPreviewBuilt().html);
      ok('with the three devices in it, under the network\'s name', got.querySelectorAll('.dev-block').length === 3
        && got.querySelector('header').textContent.includes(docDisplayName()) && got.querySelector('header').textContent.includes(todayISO()), got.querySelector('header') && got.querySelector('header').textContent);
    }
    closeSheetPreview();
    selectEntries([{ type: 'link', id: 'c1' }, { type: 'link', id: 'c3' }]);
    ok('a set of cables: not offered', gone('printLocateBtn'));
    ok('and printLocate prints nothing for it, saying why', printLocate() === null && /Select devices to print where they are plugged in\./.test(document.body.textContent));
    selectEntries([{ type: 'node', id: 'pc' }, { type: 'link', id: 'c3' }]);
    ok('a mixed set: offered, for its devices', !gone('printLocateBtn'));
    // Nothing saved until the preview's Download: then named as the locate sheet.
    {
      const realClick = HTMLAnchorElement.prototype.click;
      let downloaded = null;
      HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
      const r = printLocate([{ type: 'node', id: 'pc' }]);
      const before = downloaded;
      if (r && r.ready) await r.ready;
      el('sheetPreviewDownload').click();
      HTMLAnchorElement.prototype.click = realClick;
      ok('previewed, then the preview\'s Download saves -locate-<date>.html', !!r && r.previewed === true && before === null
        && /-locate-\d{4}-\d{2}-\d{2}\.html$/.test(downloaded || '') && el('sheetPreviewDialog').classList.contains('hidden'), downloaded);
    }

    // ---- The section: one device ----
    select('pc', 'node');
    el('locateGroup').open = true;
    renderLocate(getNode('pc'));
    const pbtn = el('locateBody').querySelector('[data-loc-print]');
    ok('the Locate section has Print, beside Show on map', !!pbtn && !!pbtn.previousElementSibling && pbtn.previousElementSibling.hasAttribute('data-loc-show'));
    capture();
    if (pbtn) pbtn.click();
    if (sheetPreviewBuilt()) {
      const got = parse(sheetPreviewBuilt().html);
      ok('it prints that one device', got.querySelectorAll('.dev-block').length === 1 && got.querySelector('h2').textContent === 'Front desk');
    } else ok('it prints that one device', false, 'nothing previewed');
    closeSheetPreview();
    // A phone: Print is a 44px target like Show on map.
    if (window.matchMedia('(max-width: 900px)').matches) {
      ok('a 44px target on a phone', pbtn.getBoundingClientRect().height >= 44 || !pbtn.offsetParent, pbtn.getBoundingClientRect().height);
    }
    ok('none of it is an edit: the document byte for byte, no undo step', JSON.stringify(serializeDoc()) === before && steps() === stepsBefore);

    // ---- The reduced views: not there ----
    selectEntries(['pc', 'np'].map((id) => ({ type: 'node', id })));
    reduce('simple');
    ok('#simple: no Print where they are plugged in', gone('printLocateBtn'));
    state.settings.profile = heldProfile.profile; state.settings.advanced = true; applyProfile();

    // ---- Spanish, and the four locales ----
    setLocale('es');
    {
      const es = parse(locateHtml(locateRows(entries), { site: 'S', date: '2026-11-04' }));
      ok('Spanish: the title and the gaps', es.title === 'Dónde están conectados' && /No hay ningún cable registrado\./.test(es.body.textContent)
        && /No se eligió puerto en Desk switch\./.test(es.body.textContent) && /Roseta Reception 2/.test(es.body.textContent), es.title);
      ok('the sheet is in the page\'s language', es.documentElement.lang === 'es', es.documentElement.lang);
    }
    setLocale('en');
    const keys = ['Print where they are plugged in', 'Print where it is plugged in: a page to take on site.', 'Where they are plugged in',
      'Select devices to print where they are plugged in.',
      'Each device: the cables it is on, the port and jack at the far end, and where that is. What is not recorded is said, never guessed.'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const miss = keys.filter((k) => !CarinoI18N.MESSAGES[loc] || !(k in CarinoI18N.MESSAGES[loc]));
      ok(`${loc} has the print sheet strings (MESSAGES)`, miss.length === 0, miss.join(' | '));
    });
    ok('Japanese says PC, never コンピューター', !keys.some((k) => /コンピュータ/.test(CarinoI18N.MESSAGES.ja[k] || '')));

    // ---- Scale: a 300-device sheet ----
    {
      const nodes = [N('s', 'switch', { name: 'SW', interfaces: [], portCount: 400 })], links = [];
      for (let k = 1; k <= 300; k++) { nodes.push(N(`h${k}`, 'pc', { name: `H${k}` })); links.push(L(`l${k}`, `h${k}`, 'e1', 's', `p${k}`)); }
      replaceDocument({ v: DOC_VERSION, nodes, links }, { origin: 'file' });
      const t0 = performance.now();
      const big = locateHtml(locateRows(nodes.map((n) => ({ type: 'node', id: n.id }))), { site: 'S', date: '2026-11-04' });
      const ms = performance.now() - t0;
      ok('300 devices: a block each, within a second', parse(big).querySelectorAll('.dev-block').length === 301 && ms < 1000, `${Math.round(ms)} ms`);
    }
  } catch (e) {
    ok('locateprint suite ran without throwing', false, e && (e.stack || e.message));
  } finally {
    window.open = heldOpen;
    URL.createObjectURL = heldURL;
    setLocale('en');
    state.settings.profile = heldProfile.profile; state.settings.advanced = heldProfile.advanced; applyProfile();
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
