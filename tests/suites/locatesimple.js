// Locate stage 4 (docs/BACKLOG.md, feature 1, landing order step 4): the
// reduced views' plain sentence and the Simple summary's socket text
// (locatePlainSentence / locateSocketText, js/model.js; #locateSentence,
// js/locate.js). What is held:
//   7. the sentence in #simple and #imagenology: one plain read-only line in
//      the device panel, built from locatePath, the switch's port a "socket"
//      and its jack label the "wall socket", the groups by name; never the
//      via, the VLAN or the rack units; Wi-Fi through the AP then the AP's
//      socket; a cable with no port says "Which socket is not written down.";
//      nothing at all says "Not plugged into anything yet."; a VM runs on its
//      host; two radio clients say which AP is not written down; hidden in
//      Full and with nothing selected; W (no longer simpleHidden) shows it
//      and is in the reduced cheatsheet; no edit and no undo step; wraps with
//      no horizontal scroll; Spanish, Japanese and Russian; the singular for
//      one step; every new string in es, pt-BR, ja and ru; '#asset/<tag>' in a
//      reduced view selects the device and shows the sentence;
//   9. the Simple summary: an end device's Where cell gains "switch, socket
//      N (jack)" only when the register holds a port, after its place, or on
//      its own when it has none (the Where column then appears); nothing for
//      Wi-Fi, for no port, for a switch; byte for byte the same sheet when
//      no socket is known, on every template too; translated.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const el = (id) => document.getElementById(id);
  const gone = (id) => getComputedStyle(el(id)).display === 'none' || el(id).offsetParent === null;
  const undoBtn = () => el('undoBtn');
  const steps = () => { const m = /\((\d+)\)/.exec(undoBtn().title); return undoBtn().disabled ? 0 : (m ? Number(m[1]) : -1); };
  const NIC = (...names) => names.map((name, k) => ({ id: `e${k + 1}`, name, ip: '' }));
  const N = (id, type, extra = {}) => Object.assign({ id, type, name: id.toUpperCase(), x: 0, y: 0, interfaces: NIC('eth0') }, extra);
  const L = (id, source, sourceIface, target, targetIface, extra = {}) => Object.assign({ id, source, target, sourceIface, targetIface }, extra);
  const WIFI = (id, name, extra = {}) => N(id, 'pc', Object.assign({ name, interfaces: [{ id: 'w1', name: 'wlan0', ip: '', wireless: true }] }, extra));
  const VIA = 'PP-A:12 > WJ-3B';
  const doc = () => ({ v: DOC_VERSION,
    nodes: [
      N('sw1', 'switch', { name: 'Office switch', group: 'rk', rackU: 40, interfaces: [], portCount: 24,
        portAttrs: { p3: { label: 'Reception 2', vlan: 10 } } }),
      N('pc', 'pc', { name: 'Front desk', group: 'rec', assetTag: 'CS-0900' }),
      N('bare', 'pc', { name: 'Bare PC' }),
      N('np', 'pc', { name: 'No port PC', group: 'rec' }),
      N('lone', 'pc', { name: 'Lone PC', group: 'rec' }),
      WIFI('tv', 'Living TV', { group: 'rec' }),
      N('ap1', 'ap', { name: 'Living AP', group: 'rec', interfaces: [] }),
      N('hst', 'server', { name: 'HST', group: 'rk', rackU: 20 }),
      N('vm', 'vm', { name: 'VM-9', host: 'hst', interfaces: [{ id: 'v1', name: 'eth0', ip: '' }] }),
      WIFI('ra', 'Radio A'), WIFI('rb', 'Radio B')
    ],
    links: [
      L('c1', 'pc', 'e1', 'sw1', 'p3', { cable: { label: 'A-01', via: VIA } }),
      L('c2', 'bare', 'e1', 'sw1', 'p5'),
      L('c3', 'np', 'e1', 'sw1', null),
      L('c4', 'tv', 'w1', 'ap1', null, { medium: 'wireless' }),
      L('c5', 'ap1', 'p1', 'sw1', 'p4'),
      L('c6', 'hst', 'e1', 'sw1', 'p6'),
      L('c7', 'ra', 'w1', 'rb', 'w1', { medium: 'wireless' })
    ],
    groups: [{ id: 'bld', name: 'HQ', kind: 'building' }, { id: 'room', name: 'Server room', kind: 'room', parent: 'bld' },
      { id: 'rk', name: 'Rack S', kind: 'rack', parent: 'room', uHeight: 42 }, { id: 'rec', name: 'Reception', kind: 'room', parent: 'bld' }] });
  const sentence = () => el('locateSentence').textContent;
  const show = (id) => { select(id, 'node'); return sentence(); };
  const press = (key) => {
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  };
  const heldProfile = { profile: state.settings.profile, advanced: state.settings.advanced };
  const reduce = (profile) => { state.settings.profile = profile; state.settings.advanced = false; applyProfile(); };
  const full = () => { state.settings.profile = heldProfile.profile; state.settings.advanced = true; applyProfile(); };
  setLocale('en');

  try {
    replaceDocument(doc(), { origin: 'file' });
    setView('map');
    const before = JSON.stringify(serializeDoc()), stepsBefore = steps();

    // ---- 7. The sentence ----
    ok('a <p id="locateSentence"> in the device panel, not data-adv', el('nodeGeneralProps').contains(el('locateSentence'))
      && el('locateSentence').tagName === 'P' && !el('locateSentence').hasAttribute('data-adv'));
    select('pc', 'node');
    ok('the Full editor never shows it', gone('locateSentence') && sentence() === '');
    reduce('simple');
    ok('#simple: the Locate section is gone', gone('locateGroup'));
    const wired = sentence();
    ok('#simple: the plain sentence, socket and wall socket, the switch\'s rooms by name',
      wired === 'Plugged into Office switch, socket 3 (wall socket Reception 2). Office switch is in HQ › Server room › Rack S.', wired);
    ok('and it is shown', !gone('locateSentence'));
    ok('no via, no VLAN, no rack units, no group kinds', !wired.includes('PP-A') && !/VLAN|U40|front|Room |Building /.test(wired), wired);
    ok('a cable with no jack label: the socket only', show('bare') === 'Plugged into Office switch, socket 5. Office switch is in HQ › Server room › Rack S.', sentence());
    ok('Wi-Fi: through the AP, then the AP\'s socket', show('tv') === 'On Wi-Fi through Living AP. Living AP is plugged into Office switch, socket 4. Office switch is in HQ › Server room › Rack S.', sentence());
    ok('a cable with no port picked: plain words, never a guessed socket',
      show('np') === 'Plugged into Office switch. Which socket is not written down. Office switch is in HQ › Server room › Rack S.', sentence());
    ok('nothing recorded', show('lone') === 'Not plugged into anything yet.', sentence());
    ok('a VM runs on its host, then the host named as what is plugged in', show('vm') === 'Runs on HST. HST is plugged into Office switch, socket 6. Office switch is in HQ › Server room › Rack S.', sentence());
    ok('two radio clients: which access point is not written down', show('ra') === 'On Wi-Fi with Radio B. Which access point it uses is not written down.', sentence());
    ok('a core switch: what it is plugged into is not written down', show('sw1') === 'What it is plugged into is not written down.', sentence());
    select(null, null);
    ok('nothing selected: empty and hidden', sentence() === '' && gone('locateSentence'));
    // A PC behind a phone, and a walk that runs out: one sentence per step.
    {
      const d = doc();
      d.nodes.push(N('ph', 'voip', { name: 'Desk phone', interfaces: NIC('lan', 'pc') }), N('pp', 'pc', { name: 'Phone PC' }),
        N('y1', 'pc', { name: 'Y1' }), N('y2', 'pc', { name: 'Y2', interfaces: NIC('a', 'b', 'c') }), N('y3', 'pc', { name: 'Y3' }), N('y4', 'pc', { name: 'Y4' }));
      d.links.push(L('p1', 'pp', 'e1', 'ph', 'e2'), L('p2', 'ph', 'e1', 'sw1', 'p7'),
        L('y12', 'y1', 'e1', 'y2', 'e1'), L('y23', 'y2', 'e2', 'y3', 'e1'), L('y24', 'y2', 'e3', 'y4', 'e1'));
      replaceDocument(d, { origin: 'file' });
      reduce('simple');
    }
    ok('behind an IP phone: each step its own sentence', show('pp') === 'Plugged into Desk phone. Desk phone is plugged into Office switch, socket 7. Office switch is in HQ › Server room › Rack S.', sentence());
    ok('a fork: what it is plugged into is not written down', show('y1') === 'Plugged into Y2. What Y2 is plugged into is not written down.', sentence());
    // #imagenology is a reduced view too.
    reduce('imagenology');
    ok('#imagenology shows the sentence too', show('pp').startsWith('Plugged into Desk phone.') && !gone('locateSentence') && gone('locateGroup'), sentence());
    // Two ends that both serve radio: no direction stated, and the gap is
    // which AP is upstream, never the far AP's (recorded) cable. A retired
    // switch says so, as Full does.
    {
      const d = doc();
      d.nodes.push(N('root', 'ap', { name: 'Root AP', interfaces: [] }), N('mesh', 'ap', { name: 'Mesh AP', interfaces: [] }), WIFI('mtv', 'Mesh TV'),
        N('rtr', 'router', { name: 'Router' }), N('rap', 'ap', { name: 'Router AP', interfaces: [] }),
        N('osw', 'switch', { name: 'Old switch', interfaces: [], portCount: 8, status: 'retired' }), N('opc', 'pc', { name: 'Old PC' }));
      d.links.push(L('m1', 'root', 'p1', 'sw1', 'p8'), L('m2', 'mesh', null, 'root', null, { medium: 'wireless' }),
        L('m3', 'mtv', 'w1', 'mesh', null, { medium: 'wireless' }), L('m4', 'rap', null, 'rtr', null, { medium: 'wireless' }),
        L('o1', 'opc', 'e1', 'osw', 'p3'));
      replaceDocument(d, { origin: 'file' });
      reduce('simple');
    }
    ok('a mesh AP: on Wi-Fi with the other AP, which AP is upstream not written down',
      show('mesh') === 'On Wi-Fi with Root AP. Which access point is upstream is not written down.', sentence());
    ok('a client of the mesh AP: through it, then which AP is upstream', show('mtv') === 'On Wi-Fi through Mesh AP. Which access point is upstream is not written down.', sentence());
    ok('an AP on a router\'s radio: no direction, no false "What Router is plugged into"',
      show('rap') === 'On Wi-Fi with Router. Which access point is upstream is not written down.', sentence());
    ok('a retired switch: said in plain words', show('opc') === 'Plugged into Old switch, socket 3. Old switch is retired.', sentence());
    {
      const r = new DOMParser().parseFromString(summarySheet(reportModel()), 'text/html');
      const tr = [...r.querySelectorAll('.summary-list tbody tr')].find((x) => x.querySelector('td b').textContent === 'Old PC');
      ok('the summary marks a retired switch\'s socket', !!tr && tr.textContent.includes('Old switch (Retired), socket 3'), tr && tr.textContent);
    }
    replaceDocument(doc(), { origin: 'file' });
    reduce('simple');
    // W: no longer simpleHidden, and in the reduced cheatsheet.
    const w = SHORTCUTS.find((s) => s.keys[0] === 'W');
    ok('W is no longer simpleHidden', w && w.simpleHidden === false);
    renderShortcutHelp();
    ok('the reduced cheatsheet lists it', [...document.querySelectorAll('#shortcutBody .shortcut-row')].some((r) => /Where is it plugged in\?/.test(r.textContent)));
    select('pc', 'node');
    el('locateSentence').textContent = '';
    el('locateGroup').open = false;
    press('w');
    ok('W in #simple shows the sentence, never the section', sentence().startsWith('Plugged into Office switch, socket 3') && !gone('locateSentence') && el('locateGroup').open === false, sentence());
    select(null, null);
    press('w');
    ok('W with nothing selected does nothing there (no search box)', document.activeElement !== el('queryInput') && sentence() === '');
    // A phone: the sentence wraps, never scrolls.
    getNode('sw1').name = 'A very long switch name with no breaks Ünïcödé_______________________________________';
    select('pc', 'node');
    const p = el('locateSentence');
    ok('a long name wraps with no horizontal scroll', p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().right <= window.innerWidth + 0.5, `${p.scrollWidth}/${p.clientWidth}`);
    replaceDocument(doc(), { origin: 'file' });
    reduce('simple');
    // The words.
    select('pc', 'node');
    setLocale('es'); renderLocate(locateNode());
    ok('Spanish: puerto and roseta', sentence() === 'Conectado a Office switch, puerto 3 (roseta Reception 2). Office switch está en HQ › Server room › Rack S.', sentence());
    setLocale('ja'); renderLocate(locateNode());
    ok('Japanese: 情報コンセント', sentence().includes('情報コンセント Reception 2') && sentence().includes('ポート 3'), sentence());
    setLocale('ru'); renderLocate(locateNode());
    ok('Russian: розетка', sentence().includes('розетка Reception 2'), sentence());
    setLocale('en'); renderLocate(locateNode());
    const one = locatePath(getNode('pc'));
    const capped = Object.assign({}, one, { legs: [Object.assign({}, one.legs[0], { stop: { reason: 'depth', node: getNode('sw1') } })] });
    ok('one step reads in the singular', locatePlainSentence(capped).endsWith('Stopped after 1 step.'), locatePlainSentence(capped));
    const keys = ['Runs on {host}.', 'Not plugged into anything yet.', 'What it is plugged into is not written down.', 'On Wi-Fi through {ap}.',
      '{device} is on Wi-Fi through {ap}.', 'On Wi-Fi with {device}.', '{device} is on Wi-Fi with {other}.', 'Which access point it uses is not written down.',
      'Plugged into {switch}, socket {port} (wall socket {jack}).', 'Plugged into {switch}, socket {port}.', 'Plugged into {switch}.',
      '{device} is plugged into {switch}, socket {port} (wall socket {jack}).', '{device} is plugged into {switch}, socket {port}.', '{device} is plugged into {switch}.',
      'Which socket is not written down.', '{device} is in {place}.', 'Which access point is upstream is not written down.', 'What {device} is plugged into is not written down.',
      '{switch}, socket {port} ({jack})', '{switch}, socket {port}', 'Stopped after {n} step.', 'Stopped after {n} steps.'];
    ['es', 'pt-BR', 'ja', 'ru'].forEach((loc) => {
      const missing = keys.filter((k) => !CarinoI18N.MESSAGES[loc] || !(k in CarinoI18N.MESSAGES[loc]));
      ok(`${loc} has the plain Locate strings (MESSAGES)`, missing.length === 0, missing.join(' | '));
    });
    ok('Japanese says PC, never コンピューター', !keys.some((k) => /コンピュータ/.test(CarinoI18N.MESSAGES.ja[k] || '')));
    ok('none of it is an edit: the document byte for byte, no undo step', JSON.stringify(serializeDoc()) === before && steps() === stepsBefore);

    // #asset/<tag> in a reduced view: selected, the sentence shown.
    select(null, null);
    const hit = await openAssetLink('cs-0900');
    ok('#asset/<tag> in #simple selects the device and shows the sentence', hit === true && state.selectedId === 'pc'
      && !gone('locateSentence') && sentence().startsWith('Plugged into Office switch, socket 3') && el('locateGroup').open === false, sentence());
    full();
    ok('back in Full the sentence is gone', sentence() === '' && gone('locateSentence'));

    // ---- 9. The Simple summary ----
    const row = (html, name) => {
      const t = new DOMParser().parseFromString(html, 'text/html');
      const heads = [...t.querySelectorAll('.summary-list thead th')].map((h) => h.textContent);
      const tr = [...t.querySelectorAll('.summary-list tbody tr')].find((r) => r.querySelector('td b').textContent === name);
      const at = heads.indexOf('Where');
      return { heads, where: tr && at >= 0 ? tr.children[at].textContent : null };
    };
    replaceDocument(doc(), { origin: 'file' });
    let model = reportModel(), html = summarySheet(model);
    ok('a wired end device: its place, then the socket with the jack', row(html, 'Front desk').where === 'HQ / Reception · Office switch, socket 3 (Reception 2)', row(html, 'Front desk').where);
    ok('no jack label: the socket alone', row(html, 'Bare PC').where === 'Office switch, socket 5', row(html, 'Bare PC').where);
    ok('a VM: its host\'s socket', /Office switch, socket 6$/.test(row(html, 'VM-9').where || ''), row(html, 'VM-9').where);
    ok('no port picked: nothing added, never a guess', row(html, 'No port PC').where === 'HQ / Reception', row(html, 'No port PC').where);
    ok('Wi-Fi: no socket (it is in none)', row(html, 'Living TV').where === 'HQ / Reception', row(html, 'Living TV').where);
    ok('a switch and an AP get none (their uplink is topology)', !/socket/.test(row(html, 'Office switch').where || '') && !/socket/.test(row(html, 'Living AP').where || ''));
    // A device with a socket but no place still opens the Where column.
    {
      const d = { v: DOC_VERSION, nodes: [N('s', 'switch', { name: 'SW', interfaces: [], portCount: 8 }), N('a', 'pc', { name: 'PC A' })],
        links: [L('k', 'a', 'e1', 's', 'p2')] };
      replaceDocument(d, { origin: 'file' });
      const r = row(summarySheet(reportModel()), 'PC A');
      ok('a socket but no place: the Where column appears with the socket', r.heads.includes('Where') && r.where === 'SW, socket 2', JSON.stringify(r));
    }
    // Byte for byte when no socket is known, against an independent copy of
    // the device list as it was before stage 4 (placeOf = place || location;
    // the rest of the sheet is untouched by it): the list in the sheet must
    // be exactly this, raw HTML, whitespace and escaping included.
    const oldList = (m) => {
      const devices = m.devices || [], own = m.customColumns || [];
      if (!devices.length) return '';
      if (devices.length > SUMMARY_LIST_MAX) return `<p class="muted">${escapeHtml(t('The full list of devices is in the technical report.'))}</p>`;
      const placeOf = (d) => d.place || d.location || '';
      const anyPlace = devices.some(placeOf);
      const cell = (d, name) => { const x = (d.custom || []).find((c) => c.name === name); return x ? escapeHtml(x.text) : ''; };
      return `<table class="summary-list">
        <thead><tr><th>${escapeHtml(t('Device'))}</th><th>${escapeHtml(t('Kind'))}</th>${anyPlace ? `<th>${escapeHtml(t('Where'))}</th>` : ''}${own.map((n) => `<th>${escapeHtml(n)}</th>`).join('')}</tr></thead>
        <tbody>${devices.map((d) => `<tr><td><b>${escapeHtml(d.name)}</b>${d.status === 'retired' ? ` <span class="muted">(${escapeHtml(statusName('retired'))})</span>` : ''}</td><td>${escapeHtml(t(d.typeName))}</td>${anyPlace ? `<td>${escapeHtml(placeOf(d))}</td>` : ''}${own.map((n) => `<td>${cell(d, n)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
    };
    const asBefore = (m) => { const html = summarySheet(m), want = oldList(m); return want !== '' && html.includes(want); };
    // With locateSocketText answering '' (no socket known anywhere), on the
    // model reportModel builds; restored after.
    const noSockets = (fn) => { const real = window.locateSocketText; window.locateSocketText = () => ''; try { return fn(); } finally { window.locateSocketText = real; } };
    {
      const d = doc();
      d.links.forEach((l) => { if (l.target === 'sw1') l.targetIface = null; });
      replaceDocument(d, { origin: 'file' });
      model = reportModel();
      ok('no port anywhere: no device carries a socket', model.devices.every((x) => !('socket' in x)));
      ok('and the device list is byte for byte the one before stage 4', asBefore(model));
      // An escaped place is still escaped once, never twice, never raw.
      const e = { v: DOC_VERSION, nodes: [N('s', 'switch', { name: 'SW', interfaces: [] }), N('a', 'pc', { name: 'PC A', location: 'R&D <2>' })], links: [] };
      replaceDocument(e, { origin: 'file' });
      ok('a place with & and <: the Where cell exactly as before', summarySheet(reportModel()).includes('<td>R&amp;D &lt;2&gt;</td>') && asBefore(reportModel()));
      const n = { v: DOC_VERSION, nodes: [N('s', 'switch', { name: 'SW', interfaces: [] }), N('a', 'pc', { name: 'PC A' })], links: [L('k', 'a', 'e1', 's', null)] };
      replaceDocument(n, { origin: 'file' });
      ok('no place and no socket: still no Where column', !row(summarySheet(reportModel()), 'PC A').heads.includes('Where'));
    }
    // Every template: where a sample holds no socket, the sheet is unchanged.
    let checked = 0, gained = 0;
    const bad = [];
    for (const key of Object.keys(templatesData)) {
      replaceDocument(templatesData[key], { origin: 'default' });
      const m = reportModel();
      const any = m.devices.some((x) => x.socket);
      if (any) gained++;
      else if (!asBefore(m)) bad.push(key);
      // Every template, the ones that gain a socket too: with none known,
      // exactly the list as before.
      const none = noSockets(() => reportModel());
      if (none.devices.some((x) => 'socket' in x) || !asBefore(none)) bad.push(`${key} (no socket known)`);
      if (m.devices.some((x) => x.socket && !/, socket /.test(x.socket))) bad.push(`${key} (shape)`);
      checked++;
    }
    ok('every template: no socket known, the device list byte for byte as before stage 4', checked > 10 && gained > 0 && bad.length === 0, `${checked} checked, ${gained} gain a socket; ${bad.join(', ')}`);
    // Over the list's limit no socket is worked out at all (the list is not printed).
    {
      const nodes = [N('s', 'switch', { name: 'SW', interfaces: [], portCount: 96 })], links = [];
      for (let k = 1; k <= SUMMARY_LIST_MAX; k++) { nodes.push(N(`h${k}`, 'pc', { name: `H${k}` })); links.push(L(`l${k}`, `h${k}`, 'e1', 's', `p${k}`)); }
      replaceDocument({ v: DOC_VERSION, nodes, links }, { origin: 'file' });
      ok('past the list limit: none worked out', reportModel().devices.every((x) => !('socket' in x)));
    }
    replaceDocument(doc(), { origin: 'file' });
    setLocale('es');
    {
      const list = new DOMParser().parseFromString(summarySheet(reportModel()), 'text/html').querySelector('.summary-list');
      ok('the socket text in Spanish', !!list && list.textContent.includes('HQ / Reception · Office switch, puerto 3 (Reception 2)'), list && list.textContent.slice(0, 200));
    }
    setLocale('en');
  } catch (e) {
    ok('locatesimple suite ran without throwing', false, e && (e.stack || e.message));
  } finally {
    setLocale('en');
    state.settings.profile = heldProfile.profile; state.settings.advanced = heldProfile.advanced; applyProfile();
  }

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n'); document.body.appendChild(pre);
}, 0); });
