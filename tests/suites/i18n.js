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
  ok('a zero is still interpolated', t('{n} link(s) on distinct interfaces.', { n: 0 }) === '0 link(s) on distinct interfaces.',
     t('{n} link(s) on distinct interfaces.', { n: 0 }));

  // ---- The findings, for real, in every language ----
  const before = state.settings.lang;
  loadTemplateState(templatesData.errors); autoBindLinks(); renderCanvasOnly();

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
      loadTemplateState(templatesData[key]); autoBindLinks();
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
  loadTemplateState(templatesData.errors); autoBindLinks();
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
  localStorage.removeItem(LIBRARY_KEY);
  loadTemplateState(templatesData.errors); autoBindLinks();
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
    ok(`${loc}: the storage warning is translated`, !/this is not an account/i.test(text));
    ok(`${loc}: a card's device count is translated`, !/\d+ devices/.test(text), (text.match(/\d+ devices/) || [])[0]);
    ok(`${loc}: no unfilled placeholder reaches a card`, !/\{\w+\}/.test(text), (text.match(/\{\w+\}/) || [])[0]);
    ok(`${loc}: the customer's own site name is untouched`, text.includes('Hospital San José — Torre B'));
  });
  setLocale('en'); applyLocale();
  closeLanding();
  localStorage.removeItem(LIBRARY_KEY);

  // Switching back has to actually switch back, or one language test poisons
  // every assertion after it.
  setLocale('en');
  loadTemplateState(templatesData.errors); autoBindLinks();
  ok('English comes back on the way out',
     topologyFindings().every((f, i) => f.line === english[i].line), topologyFindings()[0]?.line.slice(0, 50));
  state.settings.lang = before;

  const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
  document.body.appendChild(pre);
}, 400); });
