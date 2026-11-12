// The findings are translated now, and they end up in a signed document. Two
// classes of bug matter here and neither is visible on screen: a message added
// to one locale and forgotten in the others, and a translation that quietly
// drops a {placeholder} — which does not look broken, it just loses the subnet
// or the device name the sentence was about.
window.addEventListener('load', () => { setTimeout(() => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);

  const { MESSAGES, locales } = window.CarinoI18N;
  const placeholders = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join(',');

  ok('the catalogue covers every offered locale',
     ['es', 'pt-BR', 'ru', 'ja'].every((l) => locales.includes(l)), locales.join(','));

  // Parity is checked against the union, not against one favoured locale, so
  // adding a key to any single dictionary fails the other three.
  const union = new Set();
  locales.forEach((l) => Object.keys(MESSAGES[l]).forEach((k) => union.add(k)));
  ok('the catalogue is not empty', union.size > 50, `${union.size} keys`);

  locales.forEach((loc) => {
    const keys = new Set(Object.keys(MESSAGES[loc]));
    const missing = [...union].filter((k) => !keys.has(k));
    ok(`${loc} carries every message`, missing.length === 0,
       missing.length ? `${missing.length} missing, first: ${JSON.stringify(missing[0].slice(0, 50))}` : '');
  });

  locales.forEach((loc) => {
    const wrong = Object.entries(MESSAGES[loc])
      .filter(([k, v]) => placeholders(k) !== placeholders(v));
    ok(`${loc} keeps every placeholder`, wrong.length === 0,
       wrong.length ? `${JSON.stringify(wrong[0][0].slice(0, 45))} [${placeholders(wrong[0][0])}] -> [${placeholders(wrong[0][1])}]` : '');
    const empty = Object.entries(MESSAGES[loc]).filter(([, v]) => !String(v).trim());
    ok(`${loc} has no blank translations`, empty.length === 0, empty.map((e) => e[0].slice(0, 30)).join(','));
  });

  // ---- Interpolation ----
  ok('a placeholder is filled', t('Invalid gateway IP: {gw}', { gw: '10.0.0.1' }) === 'Invalid gateway IP: 10.0.0.1',
     t('Invalid gateway IP: {gw}', { gw: '10.0.0.1' }));
  // A missing param must leave the brace visible rather than print "undefined":
  // a report that says "Gateway undefined is unreachable" is worse than one that
  // is obviously unfinished.
  ok('a missing param leaves the brace alone', t('Invalid gateway IP: {gw}', {}) === 'Invalid gateway IP: {gw}',
     t('Invalid gateway IP: {gw}', {}));
  ok('a zero is still interpolated', t('{n} links on distinct interfaces.', { n: 0 }) === '0 links on distinct interfaces.',
     t('{n} links on distinct interfaces.', { n: 0 }));

  // ---- The findings, for real, in every language ----
  const before = state.settings.lang;
  loadDocState(templatesData.errors); autoBindLinks(); renderCanvasOnly();

  setLocale('en');
  const english = topologyFindings();
  ok('the broken template still raises findings in English', english.length > 0, String(english.length));

  locales.forEach((loc) => {
    setLocale(loc);
    const found = topologyFindings();
    ok(`${loc} raises the same findings`, found.length === english.length,
       `${found.length} vs ${english.length}`);
    // An unfilled brace reaching the document is the failure this whole file
    // exists to catch.
    const leftover = found.filter((f) => /\{\w+\}/.test(f.line));
    ok(`${loc} leaves no unfilled placeholder`, leftover.length === 0,
       leftover.length ? leftover[0].line.slice(0, 70) : '');
    // Every detail must have moved off English. The subject is a device name and
    // legitimately does not translate, so only the sentence is compared.
    const untranslated = found.filter((f, i) => f.detail === english[i].detail);
    ok(`${loc} translates every finding`, untranslated.length === 0,
       untranslated.length ? `${untranslated.length} left in English, first: ${untranslated[0].check}` : '');
    // The device names are data, not vocabulary — losing them would make the
    // finding unactionable, and a translation that reorders text could.
    const lostSubject = found.filter((f, i) => f.subject !== english[i].subject);
    ok(`${loc} keeps the device each finding is about`, lostSubject.length === 0,
       lostSubject.length ? `${lostSubject[0].subject} vs ${english[lostSubject.length - 1].subject}` : '');
  });

  // ---- Every evaluator, not just the ones the errors template happens to hit ----
  // topologyFindings() only surfaces bad/warn. The panel prints good and info
  // rows too, and those are the majority of the message catalogue.
  const sweep = (loc) => {
    setLocale(loc);
    const texts = [];
    ['errors', 'showcase', 'imaging', 'house'].forEach((key) => {
      loadDocState(templatesData[key]); autoBindLinks();
      state.nodes.forEach((node) => {
        [evaluateInterfaces, evaluateMultiHoming, evaluateBond, evaluatePorts,
         evaluateRadio, evaluateMac, evaluateGateway, evaluateDns].forEach((check) => texts.push(check(node).text));
      });
    });
    return texts;
  };
  const sweepEn = sweep('en');
  ok('the sweep reaches a real number of messages', sweepEn.length > 100, String(sweepEn.length));

  locales.forEach((loc) => {
    const texts = sweep(loc);
    const braces = texts.filter((x) => /\{\w+\}/.test(x));
    ok(`${loc}: no evaluator leaves a placeholder unfilled`, braces.length === 0, braces[0] || '');
    const same = texts.filter((x, i) => x === sweepEn[i] && /[a-z]{4}/.test(x));
    ok(`${loc}: no evaluator falls back to English`, same.length === 0,
       same.length ? `${same.length} of ${texts.length}, first: ${same[0].slice(0, 60)}` : '');
  });

  // ---- The document, not just the strings behind it ----
  // The report chrome lives in the same catalogue as the findings precisely so
  // that a reader never gets Japanese findings under English headings.
  loadDocState(templatesData.errors); autoBindLinks();
  state.report = { site: 'Hospital San José', client: '', engineer: '', ref: 'CS-1', date: '2026-09-05', scope: '' };
  const englishDoc = (setLocale('en'), reportHtml(reportModel(), null));

  locales.forEach((loc) => {
    setLocale(loc);
    const html = reportHtml(reportModel(), null);
    // The stylesheet is full of CSS braces, so it cannot be part of this check.
    const body = html.replace(/<style>[\s\S]*?<\/style>/, '');
    ok(`${loc}: no unfilled placeholder reaches the document`, !/\{\w+\}/.test(body),
       (body.match(/\{\w+\}/) || [])[0]);
    const englishHeadings = ['>Summary<', '>Findings<', '>Device inventory<', '>Addressing<', '>Connections<', '>Scope and method<'];
    const leaked = englishHeadings.filter((h) => html.includes(h));
    ok(`${loc}: every section heading is translated`, leaked.length === 0, leaked.join(' '));
    ok(`${loc}: the scope-and-method paragraph is translated`, !/no device was scanned/i.test(html));
    // Whatever the language, the customer's own words survive verbatim.
    ok(`${loc}: the site name is untouched`, html.includes('Hospital San José'));
    ok(`${loc}: the document is a different document`, html !== englishDoc);
  });
  state.report = null;

  // ---- The landing, which is the first page a reporter ever sees ----
  // Its static text goes through applyStaticI18n(), the cards through t() at
  // render time, and the two are easy to translate separately and half-ship.
  // These assert the page as one surface.
  persistLibrary({});
  loadDocState(templatesData.errors); autoBindLinks();
  librarySave('Hospital San José — Torre B');
  const englishLanding = (setLocale('en'), applyLocale(), openLanding(false),
                          document.getElementById('landing').textContent);

  locales.forEach((loc) => {
    setLocale(loc);
    applyLocale();                       // re-runs applyStaticI18n and re-renders the cards
    const text = document.getElementById('landing').textContent;
    ok(`${loc}: the landing is in the locale`, text !== englishLanding);
    ok(`${loc}: its headline is translated`, !text.includes('Nobody ever wrote this network down'));
    ok(`${loc}: so is the drop zone`, !text.includes('Start a new network'));
    // The drop line is two keys around the .nettopo code, read as one
    // sentence; each half once said "here" and "file", so it said them twice.
    // A touch screen reads the other line (M50, .hint-open); each is checked
    // on its own.
    [['drop', '.hint-drop'], ['touch', '.hint-open']].forEach(([which, sel]) => {
      const drop = [...document.querySelectorAll('#landingDrop p')].map((p) => {
        const c = p.cloneNode(true);
        c.querySelectorAll(which === 'drop' ? '.hint-open' : '.hint-drop').forEach((x) => x.remove());
        return c.textContent;
      }).join(' ');
      const words = drop.toLowerCase().match(/[\p{L}]{4,}/gu) || [];
      const twice = words.filter((w, i) => words.indexOf(w) !== i);
      ok(`${loc}: the ${which} line says each word once`, twice.length === 0 && !!document.querySelector(`#landingDrop ${sel}`), twice.join(' '));
    });
    ok(`${loc}: the storage warning is translated`, !/this is not an account/i.test(text));
    ok(`${loc}: a card's device count is translated`, !/\d+ devices/.test(text), (text.match(/\d+ devices/) || [])[0]);
    ok(`${loc}: no unfilled placeholder reaches a card`, !/\{\w+\}/.test(text), (text.match(/\{\w+\}/) || [])[0]);
    ok(`${loc}: the customer's own site name is untouched`, text.includes('Hospital San José — Torre B'));
  });
  setLocale('en'); applyLocale();
  closeLanding();
  persistLibrary({});

  // ---- The chrome a reduced view and the landing show ----
  // I18N is allowed to be partial, and the full editor's technical vocabulary
  // stays English on purpose (see applyProfile, js/app.js). What the plain
  // views put in front of someone is not partial: the static markup that asks
  // to be translated (data-i18n and its title / aria-label / placeholder
  // forms), the tables read through t() at render time, and the mode picker.
  // A string added in English only would pass every check above, since none
  // of them is a finding. Checked by key rather than by output, so "Simple"
  // or "Cable", which are spelled the same in Spanish, still count.
  const { has } = window.CarinoI18N;
  const chrome = new Map();
  const want = (key, from) => { const k = String(key || '').trim(); if (/[A-Za-z]{2}/.test(k) && !chrome.has(k)) chrome.set(k, from); };
  document.querySelectorAll('[data-i18n]').forEach((el) => want(el.dataset.i18nKey || el.textContent, `#${el.id || el.tagName.toLowerCase()} text`));
  ['title', 'aria-label', 'placeholder'].forEach((a) => document.querySelectorAll(`[data-i18n-${a}]`).forEach((el) =>
    want(el.getAttribute(`data-i18n-${a}`) || el.getAttribute(a), `#${el.id || el.tagName.toLowerCase()} ${a}`)));
  SHORTCUTS.filter((s) => !s.simpleHidden).forEach((s) => want(s.simpleLabel || s.label, 'shortcut'));
  MOUSE_HINTS.forEach((h) => { want(h.verb, 'mouse hint'); want(h.text, 'mouse hint'); });
  [ADD_HUB, ...ADD_KINDS].forEach((k) => { want(k.name, 'Add devices name'); want(k.label, 'Add devices tile'); });
  REPORT_FIELDS.forEach((f) => want(f.label, 'report field'));
  Object.values(PROFILES).forEach((p) => { want(p.label, 'mode picker'); want(p.blurb, 'mode picker'); });
  // The Blocks tab's names stay English; what each block holds is a sentence.
  SNIPPET_META.forEach((m) => want(m.blurb, 'Blocks blurb'));
  ok('the plain chrome is a real number of strings', chrome.size > 150, `${chrome.size} keys`);
  locales.forEach((loc) => {
    const missing = [...chrome].filter(([k]) => !has(loc, k));
    ok(`${loc} carries every string the plain views show`, missing.length === 0,
       missing.length ? `${missing.length} missing, first: ${JSON.stringify(missing[0][0].slice(0, 50))} (${missing[0][1]})` : '');
  });
  // A tooltip written into index.html without data-i18n-title is English in
  // every locale, and the check above cannot see it: it reads only what asks
  // to be translated (the final review found the Netplan button's this way).
  // Every static title asks, except the two the page sets through t() itself.
  const xhr = new XMLHttpRequest();
  xhr.open('GET', 'index.html', false); xhr.send();
  const markup = new DOMParser().parseFromString(xhr.responseText, 'text/html');
  const bareTitles = [...markup.querySelectorAll('[title]')].filter((el) => !el.hasAttribute('data-i18n-title') && !['undoBtn', 'redoBtn'].includes(el.id)
    && /[A-Za-z]{2}/.test(el.getAttribute('title')));
  ok('every tooltip in the markup is translated (data-i18n-title)', bareTitles.length === 0,
     bareTitles.map((el) => `#${el.id || el.tagName.toLowerCase()}: ${el.getAttribute('title').slice(0, 40)}`).slice(0, 3).join(' | '));

  // Groups and the rack view (js/groups.js, js/groupmap.js, js/rackview.js):
  // their sentences, Front and Rear, the kinds and the rest are translated,
  // and MESSAGES parity above only sees keys someone remembered to add. So
  // every literal t('…') in those files is read off the source and asked
  // for in each locale. A key built at run time (t(label)) is not seen here;
  // the field labels are checked by name below, since the changes list and
  // the report print them. The full editor's sidebar, the findings, the
  // report, the sheets, the library and the share dialog are read the same
  // way: a singular partner (t(n === 1 ? '…' : '…')) is a literal too, and
  // it is the key most easily added to one locale and forgotten in the rest.
  // So the first argument of each t( is walked rather than matched: a quoted
  // string at its own level counts when it opens the argument or follows a
  // ? or a :, which takes both branches of a ternary and leaves the operand
  // of a comparison (t(kind === 'rack' ? …)) and a nested call's own
  // arguments (t(isWireless(i) ? …)) alone.
  const firstArgKeys = (src) => {
    const keys = [];
    const callRe = /\bt\(/g; let call;
    while ((call = callRe.exec(src))) {
      let i = call.index + 2, depth = 0, prev = '(';
      while (i < src.length) {
        const c = src[i];
        if (c === '\'' || c === '"' || c === '`') {
          let j = i + 1;
          while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
          if (c !== '`' && depth === 0 && '(?:'.includes(prev)) keys.push(src.slice(i + 1, j));
          prev = c; i = j + 1; continue;
        }
        if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) { if (depth === 0) break; depth--; }
        else if (c === ',' && depth === 0) break;
        if (!/\s/.test(c)) prev = c;
        i++;
      }
    }
    return keys;
  };
  const grpKeys = new Map();
  ['js/groups.js', 'js/groupmap.js', 'js/rackview.js', 'js/ui.js', 'js/add.js', 'js/diagnostics.js', 'js/app.js',
   'js/report.js', 'js/csv.js', 'js/library.js', 'js/share.js', 'js/table.js', 'js/providers.js', 'js/locate.js', 'js/searches.js', 'js/restore.js',
   'js/mergeapply.js', 'js/mergeui.js', 'js/mergedoors.js', 'js/routing.js', 'js/incidents.js', 'js/providermode.js', 'js/providerreport.js', 'js/desktopserver.js', 'js/importui.js', 'js/netboxexport.js', 'js/thiscomputer.js', 'js/monitors.js', 'js/visitmonitor.js', 'js/reports.js', 'js/checks.js', 'js/welcome.js', 'js/watch.js', 'js/connections.js', 'js/tracetarget.js', 'js/issues.js', 'js/changes.js'].forEach((file) => {
    const req = new XMLHttpRequest(); req.open('GET', file, false); req.send();
    firstArgKeys(req.responseText).forEach((k) => grpKeys.set(k.replace(/\\n/g, '\n').replace(/\\(['"\\])/g, '$1'), file));
  });
  // The walk sees both halves of a singular partner: pinned on one, so a
  // later change to the walk cannot quietly lose them again.
  ok('the sweep reads both branches of a ternary inside t()', grpKeys.has('{n} node · reusable template') && grpKeys.has('{n} nodes · reusable template'),
     [...grpKeys.keys()].filter((k) => /reusable template/.test(k)).join(' | '));
  ['Group', 'Rack U', 'Rack height', 'Rack face', 'Rack depth', 'Ports face'].forEach((k) => grpKeys.set(k, 'NODE_FIELDS'));
  // The providers' field labels and services (PROVIDER_FIELDS, PROVIDER_SERVICE_LABEL,
  // js/model.js) reach t() by name.
  PROVIDER_FIELDS.filter((f) => f.key !== 'id').forEach((f) => grpKeys.set(f.label, 'PROVIDER_FIELDS'));
  PROVIDER_SERVICES.forEach((k) => grpKeys.set(PROVIDER_SERVICE_LABEL[k], 'PROVIDER_SERVICE_LABEL'));
  ok('the swept files ask for a real number of strings', grpKeys.size > 600, `${grpKeys.size} keys`);
  locales.forEach((loc) => {
    const missing = [...grpKeys].filter(([k]) => !has(loc, k));
    ok(`${loc} carries every literal string of the swept files`, missing.length === 0,
       missing.length ? `${missing.length} missing, first: ${JSON.stringify(missing[0][0].slice(0, 50))} (${missing[0][1]})` : '');
  });
  // The report's rack elevation names each device's type as the inventory
  // above it does: in the reader's language, not the palette's English.
  {
    const keep = state.doc;
    setLocale('ja');
    replaceDocument({ v: DOC_VERSION, nodes: [{ id: 'f', type: 'firewall', name: 'FW1', x: 0, y: 0, interfaces: [], group: 'rk', rackU: 4 }], links: [],
      groups: [{ id: 'rk', name: 'R1', kind: 'rack', uHeight: 6 }] }, { origin: 'file', docId: 'i18n-rack' });
    const elev = new DOMParser().parseFromString(reportHtml(reportModel(), null), 'text/html').querySelector('table.elev');
    const cell = elev ? elev.textContent : '';
    ok('the rack elevation names the type in the report\'s language', /FW1/.test(cell) && cell.includes(t('Firewall')) && !/Firewall/.test(cell), cell.replace(/\s+/g, ' ').slice(0, 80));
    setLocale('en');
    if (keep) replaceDocument(keep, { origin: 'file', docId: 'i18n-back' });
  }
  // A selected cable's port pickers follow a language switch: they are
  // built, not marked up, so applyLocale has to rebuild them.
  {
    const keep = state.doc;
    loadDocState({ v: DOC_VERSION, nodes: [
      { id: 'a', type: 'pc', name: 'A', x: 0, y: 0, interfaces: [{ id: 'i1', name: 'eth0' }] },
      { id: 'b', type: 'pc', name: 'B', x: 100, y: 0, interfaces: [] }], links: [{ id: 'ab', source: 'a', target: 'b' }] });
    select('ab', 'link');
    const ports = () => document.getElementById('linkPortBody').textContent;
    const enHad = ports().includes('No interfaces — add one.');
    setLocale('es'); applyLocale();
    ok('a selected cable\'s port pickers switch language with the page', enHad && ports().includes('Sin interfaces: añade una.') && !ports().includes('No interfaces'),
       ports().slice(0, 80));
    setLocale('en'); applyLocale();
    select(null, null);
    if (keep) replaceDocument(keep, { origin: 'file', docId: 'i18n-back' });
  }

  // A key written twice in one locale: the object literal keeps the later
  // value and drops the first without a word, so one English key used in two
  // grammatical places ("The whole network" in the share dialog's accusative
  // and as the report's scope) silently changes the other place's text. The
  // source is read as text, because the loaded MESSAGES has already lost the
  // first copy. Any key repeated with a different value fails: the 13 from
  // before step 7 (D342) were given a context key each, or one translation
  // where both places meant the same thing (D350).
  {
    const req = new XMLHttpRequest(); req.open('GET', 'js/i18n.js', false); req.send();
    const text = req.responseText;
    const toks = [];
    let i = text.indexOf('{', text.indexOf('const MESSAGES = {')), depth = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (/\s/.test(c)) continue;
      if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); continue; }
      if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i) + 1; continue; }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1, s = '';
        while (text[j] !== c) { if (text[j] === '\\') { s += text[j + 1]; j += 2; } else s += text[j++]; }
        toks.push({ s }); i = j; continue;
      }
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) break;
      if (/[\w$]/.test(c)) { let j = i; while (/[\w$-]/.test(text[j + 1])) j++; toks.push({ w: text.slice(i, j + 1) }); i = j; continue; }
      toks.push({ p: c });
    }
    const conflicts = [];
    let d = 0, loc = null, seen = null, entries = 0;
    for (let k = 0; k < toks.length; k++) {
      const tk = toks[k];
      if (tk.p === '{') { if (++d === 2) { loc = toks[k - 2].s || toks[k - 2].w; seen = new Map(); } continue; }
      if (tk.p === '}') { d--; continue; }
      if (d === 2 && tk.s !== undefined && toks[k + 1] && toks[k + 1].p === ':') {
        let v = '', m = k + 2;
        while (m < toks.length && toks[m].p !== ',' && toks[m].p !== '}') { if (toks[m].s !== undefined) v += toks[m].s; m++; }
        entries++;
        if (seen.has(tk.s) && seen.get(tk.s) !== v) conflicts.push(`${loc}:${tk.s}`);
        else seen.set(tk.s, v);
        k = m - 1;
      }
    }
    ok('no key is written twice in one locale with two different translations', entries > 4 * 1000 && conflicts.length === 0,
       `${entries} entries read; ${conflicts.slice(0, 4).join(' | ')}`);
    ok('the share dialog\'s "The whole network" and the report\'s "Whole network" are two keys',
       MESSAGES.ru['The whole network'] === 'Всю сеть' && MESSAGES.ru['Whole network'] === 'Вся сеть'
       && locales.every((l) => MESSAGES[l]['Whole network']), `${MESSAGES.ru['The whole network']} / ${MESSAGES.ru['Whole network']}`);
  }

  // ---- Context keys: one English word, one translation per place (D350) ----
  {
    setLocale('en');
    ok('the report inventory\'s Type column is "Type" in English', devicesSection([], []).includes('<th>Type</th>'));
    ok('a context key shows its plain English', t('changes::Change') === 'Change' && t('backups::Status') === 'Status' && t('backups::Where') === 'Where',
       [t('changes::Change'), t('backups::Status'), t('backups::Where')].join(' / '));
    setLocale('ru');
    ok('a context key missing from a locale falls back to its English, placeholders filled', t('changes::Plain {n} words', { n: 2 }) === 'Plain 2 words', t('changes::Plain {n} words', { n: 2 }));
    const addrs = ['fe80::1', '::1', 'fe::1', 'ff::', 'dead::beef', 'cafe::1', 'nowhere::text'];
    ok('only a listed context is cut: an IPv6 address, hex-only ones included, or other text with "::" stays whole',
       addrs.every((a) => t(a) === a), addrs.map((a) => t(a)).join(' / '));
    ok('no context is ever shown: every key with "::" starts with a listed context, its English without "::"',
       locales.every((l) => Object.keys(MESSAGES[l]).every((k) => !/::/.test(k)
         || (window.I18N_CONTEXTS.includes(k.split('::')[0]) && !k.split('::').slice(1).join('::').includes('::')))));

    // Each place, rendered, in the three locales whose words differ.
    const C = window.CarinoChanges;
    const ch = { at: Date.UTC(2026, 10, 1), kind: 'backup', rows: [{ op: 'Added', what: 'Device', name: 'SW1', detail: '' }] };
    const changesHead = () => { const d = document.createElement('div'); d.innerHTML = C.changesSection(ch); return d.querySelector('th').textContent; };
    const rackChange = () => document.querySelector('#rackPlaceWhere .rkp-change').textContent;
    const want = {
      es: { noun: 'Cambio', verb: 'Cambiar', libBackup: 'Respaldar ahora', srvBackup: 'Hacer copia ahora', status: 'Estado', srvStatus: 'Estado', where: 'Dónde', srvWhere: 'Dónde', type: 'Tipo', repType: 'Tipo', past: 'Fuera del frontal de 24 puertos' },
      ru: { noun: 'Изменение', verb: 'Изменить', libBackup: 'Сделать копию сейчас', srvBackup: 'Сделать копию сейчас', status: 'Статус', srvStatus: 'Состояние', where: 'Где', srvWhere: 'Куда', type: 'Тип', repType: 'Тип', past: 'За пределами панели на 24 портов' },
      ja: { noun: '変更', verb: '変更', libBackup: '今すぐバックアップ', srvBackup: '今すぐバックアップ', status: 'ステータス', srvStatus: '状態', where: '場所', srvWhere: '保存先', type: '種類', repType: '種別', past: '24 ポートの前面パネルの外' }
    };
    // The report's two tables, rendered: the summary's device list (its
    // Where column, a place) and the technical report's inventory (its Type).
    const heads = (html, cls) => { const d = document.createElement('div'); d.innerHTML = html; return [...d.querySelectorAll(`table.${cls} thead th`)].map((th) => th.textContent); };
    const summaryHeads = () => heads(summarySheet({ meta: {}, findings: [], devices: [{ name: 'SW1', typeName: 'Switch', place: 'Rack A' }] }), 'summary-list');
    const inventoryHeads = () => heads(devicesSection([], []), 'inv');
    Object.entries(want).forEach(([loc, w]) => {
      setLocale(loc); applyLocale(loc);
      ok(`${loc}: the changes list's column says the noun, the rack view's button the verb`,
         changesHead() === w.noun && rackChange() === w.verb, `${changesHead()} / ${rackChange()}`);
      ok(`${loc}: the storage banner's and the server backups' Back up now`,
         document.getElementById('storageBackupBtn').textContent === w.libBackup && t('backups::Back up now') === w.srvBackup,
         `${document.getElementById('storageBackupBtn').textContent} / ${t('backups::Back up now')}`);
      const propStatus = document.querySelector('label[for="propStatus"]').textContent;
      ok(`${loc}: an asset's or a problem's Status, and the backups' Status`,
         propStatus === w.status && t('Status') === w.status && t('backups::Status') === w.srvStatus, `${propStatus} / ${t('backups::Status')}`);
      ok(`${loc}: the summary's Where column (a place) and the backups' Where (a destination)`,
         summaryHeads()[2] === w.where && t('backups::Where') === w.srvWhere, `${summaryHeads().join(',')} / ${t('backups::Where')}`);
      ok(`${loc}: the report inventory's Type column keeps its own word, the rack view's type picker its own`,
         inventoryHeads()[1] === w.repType && document.getElementById('rackPlaceTypes').getAttribute('aria-label') === w.type,
         `${inventoryHeads().join(',')} / ${document.getElementById('rackPlaceTypes').getAttribute('aria-label')}`);
      ok(`${loc}: "Past the {total}-port faceplate" reads as written`,
         t('Past the {total}-port faceplate', { total: 24 }) === w.past, t('Past the {total}-port faceplate', { total: 24 }));
    });

    // Markup: data-i18n-ctx builds the context key for the text and the
    // marked attributes, and switching back to English shows the plain word.
    const probe = document.createElement('span');
    probe.setAttribute('data-i18n', ''); probe.setAttribute('data-i18n-ctx', 'changes');
    probe.setAttribute('data-i18n-title', ''); probe.title = 'Change'; probe.textContent = 'Change';
    document.body.appendChild(probe);
    setLocale('ru'); applyStaticI18n();
    ok('data-i18n-ctx: the markup reads its context key', probe.dataset.i18nKey === 'changes::Change' && probe.textContent === 'Изменение'
       && probe.getAttribute('data-i18n-title') === 'changes::Change' && probe.title === 'Изменение', `${probe.dataset.i18nKey} ${probe.textContent} ${probe.title}`);
    setLocale('en'); applyStaticI18n();
    ok('data-i18n-ctx: English shows the plain word', probe.textContent === 'Change' && probe.title === 'Change', `${probe.textContent} ${probe.title}`);
    probe.remove();
    applyLocale('en');
  }

  // Switching back has to actually switch back, or one language test poisons
  // every assertion after it.
  setLocale('en');
  loadDocState(templatesData.errors); autoBindLinks();
  ok('English comes back on the way out',
     topologyFindings().every((f, i) => f.line === english[i].line), topologyFindings()[0]?.line.slice(0, 50));
  state.settings.lang = before;

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
