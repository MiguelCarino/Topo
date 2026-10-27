// R8, the small removals and merges (Review-Packs/Topo-proposal.md). Each one
// takes something away, so what is asserted is that the thing is gone AND that
// what it did still has a way in:
//   - Netplan is an action on the host types, not a stored per-node checkbox;
//     an old document that has the checkbox set still opens.
//   - "Try another mode" is hidden in the full editor; the mode picker is in
//     the How to use dialog there.
//   - The reduced views hide the technical UI through one data-adv rule.
//   - The Networks tab shows the real starting points; the rest, the Offline
//     tiers among them, sit in a collapsed Examples group, with no prices.
// Trace moving into the Diagnostics tab is in tests/suites/trace.js, Tidy
// losing Untidy in tests/suites/batch.js.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const hidden = (e) => getComputedStyle(e).display === 'none' || e.classList.contains('hidden') || e.offsetParent === null;

  try {
    // ---- Netplan: an action on the host types ----
    loadDocState({ v: DOC_VERSION, nodes: [
      { id: 'srv', type: 'server', name: 'Srv', x: 0, y: 0, gw: '10.0.0.1', interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.5/24' }] },
      { id: 'pc', type: 'pc', name: 'PC', x: 100, y: 0, interfaces: [{ id: 'i1', name: 'eth0', ip: '' }] },
      { id: 'sw', type: 'switch', name: 'SW', x: 0, y: 100, netcfg: true, portCount: 8, interfaces: [] },
      { id: 'rtr', type: 'router', name: 'R', x: 100, y: 100, netcfg: true, interfaces: [{ id: 'i1', name: 'eth0', ip: '10.0.0.1/24' }] }
    ], links: [] });
    renderCanvasOnly();
    ok('the "Network config file" checkbox is gone', !el('propNetcfg') && !el('netcfgHint'));
    select('srv', 'node');
    const a = el('openNetcfgBtn');
    ok('a server offers Open in Netplan ↗', !a.classList.contains('hidden') && /Open in Netplan ↗/.test(a.textContent), a.textContent);
    await wait(50);
    ok('the link is the netplan generator with this device encoded', /^https:\/\/netplan\.carino\.systems\/#.+/.test(a.getAttribute('href') || ''),
       a.getAttribute('href'));
    ok('and opens in a new tab without a referrer handle', a.target === '_blank' && /noopener/.test(a.rel));
    select('pc', 'node');
    ok('so does a PC (a blank address is a DHCP client)', !a.classList.contains('hidden'));
    select('sw', 'node');
    ok('a switch does not, even one an old document had ticked', a.classList.contains('hidden') && !a.getAttribute('href'));
    select('rtr', 'node');
    ok('nor a router', a.classList.contains('hidden'));
    ok('the old flag is read and not written back', !JSON.stringify(serializeDoc()).includes('netcfg'));
    select(null, null);

    // ---- The mode button: reduced views only ----
    state.settings.advanced = true; applyProfile();
    ok('"Try another mode" is hidden in the full editor', hidden(el('modeSwitchBtn')));
    toggleShortcutHelp(true);
    const helpMode = el('helpModeBtn');
    ok('the How to use dialog offers the simpler views instead', !!helpMode && !hidden(helpMode)
       && helpMode.textContent === 'Switch to a simpler view or the setup wizard');
    helpMode.click();
    ok('and it opens the mode picker', el('shortcutHelp').classList.contains('hidden') && !el('modePicker').classList.contains('hidden'));
    closeModePicker();
    state.settings.advanced = false; applyProfile();
    showLibraryTab('nodes');
    ok('the reduced view shows the button', !hidden(el('modeSwitchBtn')));
    toggleShortcutHelp(true);
    ok('and does not repeat it in How to use', !el('helpModeBtn'));
    toggleShortcutHelp(false);

    // ---- One data-adv rule ----
    const rules = [];
    [...document.styleSheets].forEach((sh) => { try { [...sh.cssRules].forEach((r) => { if (r.selectorText && /body\.simple-mode /.test(r.selectorText) && r.style.display === 'none') rules.push(r.selectorText); }); } catch (e) { /* cross-origin */ } });
    ok('the reduced views hide through one rule', rules.length === 1 && /\[data-adv\]/.test(rules[0]), rules.join(' || '));
    const advIds = ['diagTabBtn', 'cfgPanel-diagnostics', 'queryBar', 'linkProps', 'linkPortProps', 'nodeNetworkProps', 'osPortsRow',
      'notesRow', 'layer-zones', 'findTabBtn', 'cfgPanel-findings', 'conflictPill', 'exportWebpBtn', 'exportSvgBtn', 'exportJsonBtn', 'importFileBtn', 'saveTemplateBtn'];
    const untagged = advIds.filter((i) => !el(i).hasAttribute('data-adv'));
    ok('everything the old rules named carries data-adv', !untagged.length, untagged.join(','));
    const shownAdv = [...document.querySelectorAll('[data-adv]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.id || e.className);
    ok('and every data-adv element is hidden in the reduced view', !shownAdv.length, shownAdv.slice(0, 6).join(','));
    state.settings.advanced = true; applyProfile();
    ok('the full editor shows them again', getComputedStyle(el('diagTabBtn')).display !== 'none' && getComputedStyle(el('queryBar')).display !== 'none');

    // ---- Templates: starting points, then Examples ----
    showLibraryTab('templates');
    const starts = [...document.querySelectorAll('#templateList .lib-item')].map((r) => r.textContent);
    ok('the starting points are the short list', starts.length === 6 && /Smart Home/.test(starts[0]) && starts.some((s) => /Common Errors/.test(s)), starts.length + '');
    const examples = el('exampleTemplates');
    ok('the Examples group starts collapsed', examples.tagName === 'DETAILS' && !examples.open && el('exampleTemplatesSummary').textContent === 'Examples');
    const exampleText = el('exampleTemplateList').textContent;
    ok('Military Base, Vessel and Full Showcase are examples', ['Military Base', 'Vessel', 'Full Showcase'].every((n) => exampleText.includes(n)));
    ok('so are the three Offline tiers', ['Offline · Lean', 'Offline · Balanced', 'Offline · Extended'].every((n) => exampleText.includes(n)));
    ok('none of them is gone', TEMPLATE_META.every((m) => templatesData[m.key]) && ['offlineLean', 'offlineBalanced', 'offlineExtended', 'military', 'vessel', 'showcase'].every((k) => templatesData[k]));
    // Prices stay with offline.carino.systems, in every language.
    const priced = [];
    ['en', 'es', 'pt-BR', 'ja', 'ru'].forEach((lang) => {
      setLocale(lang);
      TEMPLATE_META.forEach((m) => { const b = t(m.blurb); if (/[$€£¥]|US\$|\d\s*(k|mil|тыс)\b|千ドル|ドル/.test(b)) priced.push(`${lang}:${m.key}`); });
    });
    setLocale('en');
    ok('no template blurb names a price', !priced.length, priced.join(','));
    // In the reduced views the tab itself is called Examples.
    state.settings.advanced = false; applyProfile();
    ok('in the reduced view the group is "More examples"', el('exampleTemplatesSummary').textContent === 'More examples');
    state.settings.lang = 'es'; setLocale('es'); applyLocale();
    ok('and is translated', el('exampleTemplatesSummary').textContent === 'Más ejemplos', el('exampleTemplatesSummary').textContent);
    examples.open = true;
    ok('opening it lists the examples', !hidden(el('exampleTemplateList')) && el('exampleTemplateList').children.length === TEMPLATE_META.filter((m) => m.example).length);
    examples.open = false;
    delete state.settings.lang; setLocale('en'); applyLocale();
    state.settings.advanced = true; saveSettings(); applyProfile();
    showLibraryTab('nodes');
  } catch (e) {
    ok('the suite ran to the end', false, e && (e.stack || e.message));
  } finally {
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 400); });
