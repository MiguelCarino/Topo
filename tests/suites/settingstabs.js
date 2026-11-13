// @realtime @touch 360x780
// Settings in section tabs (js/settings.js, index.html, css/app.css; step 7
// phase 7p, D361), as the navbar's About window. Covered:
//   - the markup: a tablist of six tabs, each a tab with its tabpanel; every
//     section and every control the long dialog had sits in exactly one
//     panel, in the groups D361 names;
//   - on the website (no __TAURI__): Topo server and Monitoring hidden with
//     their sections; Back-ups shown only where the folder API exists;
//   - a click shows one panel, aria-selected and the roving tabindex follow;
//     the tab is kept for this browser tab (sessionStorage) and Settings
//     opens there again; arrow keys (both directions, wrapping, skipping
//     hidden tabs), Home and End;
//   - deep links: openSettings(tab), openSettings(control id) opens its tab
//     and focuses it; revealInSettings scrolls inside the panel; a section
//     the app shows later shows its tab, and a wanted tab whose section
//     shows a moment later comes back to it; a Screen lock note not yet
//     read opens Settings at Screen lock; openSettings('setMonOn') opens at
//     Monitor from this PC (the check section's button itself is clicked in
//     the checks suite); at 360 in Russian, Settings opened at the last tab
//     (kept, or asked for) shows that tab inside the scrolled row;
//   - the dialog keeps its height from tab to tab;
//   - the tab names in es, pt-BR, ru and ja (no パソコン);
//   - at 360 and 390: the tabs a row across the top that scrolls inside
//     itself, each tab 44px tall, every tab's panel through
//     tests/fixtures/touchaudit.js, no sideways page scroll; at 1280 the tabs
//     down the side (aria-orientation vertical); Gold and Colourful (the
//     theme checked applied);
//   - no console error.
window.addEventListener('load', () => { setTimeout(async () => {
  const out = [];
  const ok = (n, c, e) => out.push(`${c ? 'PASS' : 'FAIL'} :: ${n}${e ? ' :: ' + e : ''}`);
  const errors = [];
  const cerr = console.error;
  console.error = function () { errors.push([...arguments].map(String).join(' ').slice(0, 160)); return cerr.apply(console, arguments); };
  window.addEventListener('error', (e) => errors.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', (e) => errors.push('rejection: ' + ((e.reason && e.reason.message) || e.reason)));
  const el = (id) => document.getElementById(id);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  const settle = async () => { await frame(); await frame(); await wait(60); };
  const loadScript = (src) => new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error(src)); document.head.appendChild(s); });
  const tabs = () => [...document.querySelectorAll('#settingsDialog .set-tab')];
  const tab = (k) => el('setTab-' + k);
  const panel = (k) => el('setPanel-' + k);
  const shownTab = () => { const t = tabs().find((x) => x.getAttribute('aria-selected') === 'true'); return t ? t.dataset.tab : ''; };
  const shownPanels = () => [...document.querySelectorAll('#settingsDialog .set-panel')].filter((p) => !p.hidden).map((p) => p.id);
  const key = (target, k) => target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  const KEPT = 'topo.settings.tab';
  try {
    await loadScript('tests/fixtures/touchaudit.js');
    try { sessionStorage.removeItem(KEPT); } catch (e) { /* none */ }

    // ---- The markup ----
    const bar = document.querySelector('#settingsDialog .set-tabs');
    ok('a tablist labelled by the dialog\'s title', !!bar && bar.getAttribute('role') === 'tablist' && bar.getAttribute('aria-labelledby') === 'settingsTitle');
    const KEYS = ['general', 'lock', 'server', 'monitor', 'backup', 'setup'];
    ok('six tabs in order', tabs().map((x) => x.dataset.tab).join() === KEYS.join(), tabs().map((x) => x.dataset.tab).join());
    ok('each a tab controlling its tabpanel, labelled back by it', KEYS.every((k) => tab(k).getAttribute('role') === 'tab' && tab(k).getAttribute('aria-controls') === 'setPanel-' + k
      && panel(k).getAttribute('role') === 'tabpanel' && panel(k).getAttribute('aria-labelledby') === 'setTab-' + k));
    const GROUPS = {
      general: ['setMapHead', 'setReportHead', 'setHistoryHead', 'setReporterHead'],
      lock: ['setLockHead'],
      server: ['setDcHead', 'setDsHead'],
      monitor: ['setMonHead'],
      backup: ['setBackupHead'],
      setup: ['setWelcomeHead', 'setTcHead'],
    };
    ok('the sections in their tabs, in order (D361)', KEYS.every((k) => [...panel(k).children].map((s) => s.querySelector('.set-head').id).join() === GROUPS[k].join()),
      KEYS.map((k) => k + ':' + [...panel(k).children].map((s) => s.querySelector('.set-head') && s.querySelector('.set-head').id).join('/')).join(' '));
    const secs = [...el('settingsDialog').querySelectorAll('.set-sec')];
    ok('every section is in a panel, none left loose', secs.length === 11 && secs.every((s) => s.parentElement.classList.contains('set-panel')), String(secs.length));
    const CONTROLS = ['setProviderHover', 'setSubnetZones', 'setMapInk', 'setEngineer', 'setReportSummary', 'setReportTechnical', 'setTrailRecording', 'setTrailSimple',
      'setReporterName', 'setReporterPhone', 'setReporterEmail', 'setLockAfter', 'setLockCustom', 'setLockPinSet', 'setLockNow', 'setLockNoteOk',
      'setBackupDirPick', 'setBackupDirAuto', 'setTcAdd', 'setMonOn', 'setMonQuiet', 'setMonKeep', 'setSiteMonOn', 'setAlarmOn', 'setAlarmTest',
      'setDcUrl', 'setDcConnect', 'setDcDisconnect', 'setDsStart', 'setDsOwner', 'setDsSave', 'setDsLog', 'setWelcomeAgain', 'settingsDoneBtn'];
    const missing = CONTROLS.filter((id) => !el(id) || !el('settingsDialog').contains(el(id)));
    ok('every control is still there, with its id', !missing.length, missing.join());
    ok('the tabs are translated in place (data-i18n)', tabs().every((x) => x.hasAttribute('data-i18n')));

    // ---- The website: the app's tabs hidden ----
    openSettings(); await settle();
    ok('opens at the first tab with nothing kept', shownTab() === 'general' && shownPanels().join() === 'setPanel-general', shownTab() + ' ' + shownPanels().join());
    ok('the website hides Topo server and Monitoring (their sections are the app\'s)', tab('server').hidden && tab('monitor').hidden && el('setDcSec').hidden && el('setDsSec').hidden && el('setMonSec').hidden);
    ok('Map and reports and Screen lock show', !tab('general').hidden && !tab('lock').hidden);
    ok('Setup is the desktop app\'s (D425): hidden on the website', tab('setup').hidden && el('setWelcomeSec').hidden);
    const api = typeof window.showDirectoryPicker === 'function';
    ok('Back-ups shows where the folder API exists (' + api + ')', tab('backup').hidden === !api && tab('backup').hidden === el('setBackupSec').hidden);

    // ---- A click; the roving tabindex; kept for this browser tab ----
    tab('lock').click(); await settle();
    ok('a click shows its one panel', shownTab() === 'lock' && shownPanels().join() === 'setPanel-lock' && el('setLockSec').getClientRects().length > 0, shownPanels().join());
    ok('aria-selected and tabindex follow', tabs().every((x) => (x === tab('lock')) === (x.getAttribute('aria-selected') === 'true') && x.tabIndex === (x === tab('lock') ? 0 : -1)));
    ok('the tab takes the focus', document.activeElement === tab('lock'));
    ok('kept in sessionStorage', sessionStorage.getItem(KEPT) === 'lock');
    closeSettings(); await settle();
    openSettings(); await settle();
    ok('Settings opens again at the kept tab', shownTab() === 'lock' && !panel('lock').hidden);

    // ---- Keys ----
    const live = () => tabs().filter((x) => !x.hidden).map((x) => x.dataset.tab);
    tab('lock').focus();
    key(tab('lock'), 'ArrowRight'); await settle();
    const afterLock = live()[live().indexOf('lock') + 1];
    ok('→ goes to the next tab shown, skipping hidden ones', shownTab() === afterLock && document.activeElement === tab(afterLock), shownTab() + ' wanted ' + afterLock);
    key(document.activeElement, 'ArrowLeft'); await settle();
    ok('← goes back', shownTab() === 'lock');
    key(document.activeElement, 'ArrowUp'); key(document.activeElement, 'ArrowUp'); await settle();
    ok('↑ wraps from the first to the last', shownTab() === live()[live().length - 1], shownTab());
    key(document.activeElement, 'ArrowDown'); await settle();
    ok('↓ wraps from the last to the first', shownTab() === 'general');
    key(document.activeElement, 'End'); await settle();
    ok('End: the last', shownTab() === live()[live().length - 1]);
    key(document.activeElement, 'Home'); await settle();
    ok('Home: the first', shownTab() === 'general' && document.activeElement === tab('general'));
    closeSettings(); await settle();

    // ---- Deep links ----
    // The Setup tab is the app's: a stand-in for it from here on.
    TopoWelcome.state.invoke = async () => null;
    openSettings('setup'); await settle();
    ok('openSettings(tab) opens that tab', shownTab() === 'setup' && el('setWelcomeAgain').getClientRects().length > 0);
    closeSettings(); await settle();
    openSettings('setLockAfter'); await settle();
    ok('openSettings(a control\'s id) opens its tab and focuses it', shownTab() === 'lock' && document.activeElement === el('setLockAfter'));
    closeSettings(); await settle();
    openSettings('setReporterEmail'); await settle();
    const box = document.querySelector('#settingsDialog .set-panels');
    const r = el('setReporterEmail').getBoundingClientRect(), b = box.getBoundingClientRect();
    ok('a control further down is scrolled to inside the panel', shownTab() === 'general' && document.activeElement === el('setReporterEmail') && r.top >= b.top - 1 && r.bottom <= b.bottom + 1, `${r.top}-${r.bottom} in ${b.top}-${b.bottom}`);
    ok('the dialog\'s frame did not scroll with it', el('settingsDialog').querySelector('.set-body').scrollTop === 0 && el('settingsDialog').querySelector('.modal').scrollTop === 0);
    closeSettings(); await settle();

    // The app answers: its sections show a moment after Settings opens.
    openSettings('setMonOn'); await settle();
    ok('a wanted tab whose section is hidden: the first tab with something stands in', shownTab() === 'general' && tab('monitor').hidden, shownTab());
    el('setMonSec').hidden = false; await settle();
    ok('the section shows: its tab shows and is the one shown (wanted)', !tab('monitor').hidden && shownTab() === 'monitor' && !panel('monitor').hidden, shownTab());
    el('setMonSec').hidden = true; await settle();
    ok('it hides again: the tab hides and another stands in', tab('monitor').hidden && shownTab() !== 'monitor' && !!shownTab());
    el('setMonSec').hidden = false; el('setDsSec').hidden = false; await settle();
    ok('Topo server shows with This PC as the server', !tab('server').hidden);
    revealInSettings('setDsSec'); await settle();
    ok('revealInSettings(section) shows its tab', shownTab() === 'server' && el('setDsSec').getClientRects().length > 0);
    // A control's id in a tab the app shows. The check section's own
    // Settings… button (js/checks.js, which passes 'setMonOn') is clicked in
    // the checks suite.
    closeSettings(); await settle();
    // As in the app: js/checks.js's host (its invoke) shows the section as Settings renders.
    const heldInvoke = TopoChecks.state.invoke;
    TopoChecks.state.invoke = async () => null;
    openSettings('setMonOn'); await settle();
    ok('openSettings(setMonOn): Monitoring, the tick focused', shownTab() === 'monitor' && document.activeElement === el('setMonOn'), shownTab());
    closeSettings(); await settle();
    TopoChecks.state.invoke = heldInvoke;
    el('setMonSec').hidden = true; el('setDsSec').hidden = true; await settle();
    ok('the app\'s tabs hide again with their sections', tab('monitor').hidden && tab('server').hidden);

    // A Screen lock note not yet read wins over the kept tab.
    sessionStorage.setItem(KEPT, 'setup');
    localStorage.setItem('topo-lock-note', JSON.stringify({ at: Date.now(), kind: 'forgot' }));
    openSettings(); await settle();
    ok('a Screen lock note not yet read: Settings opens at Screen lock', shownTab() === 'lock' && !el('setLockNoteRow').hidden);
    el('setLockNoteOk').click(); await settle();
    closeSettings(); await settle();
    openSettings(); await settle();
    ok('read (OK): the kept tab again', shownTab() === 'setup', shownTab());
    closeSettings(); await settle();

    // ---- Height ----
    openSettings('general'); await settle();
    const hs = [];
    for (const k of live()) { tab(k).click(); await settle(); hs.push(Math.round(el('settingsDialog').querySelector('.modal').getBoundingClientRect().height)); }
    ok('the dialog keeps its height from tab to tab', hs.every((h) => h === hs[0]) && hs[0] > 200, hs.join());
    closeSettings(); await settle();

    // ---- Words ----
    const NAMES = { es: ['Mapa e informes', 'Bloqueo de pantalla', 'Servidor Topo', 'Monitoreo', 'Copias de seguridad', 'Configuración inicial'],
      'pt-BR': ['Mapa e relatórios', 'Bloqueio de tela', 'Servidor Topo', 'Monitoramento', 'Backups', 'Configuração inicial'],
      ru: ['Карта и отчёты', 'Блокировка экрана', 'Сервер Topo', 'Наблюдение', 'Резервные копии', 'Начальная настройка'],
      ja: ['マップとレポート', '画面ロック', 'Topoサーバー', '監視', 'バックアップ', 'セットアップ'] };
    for (const loc of Object.keys(NAMES)) {
      setLocale(loc); applyLocale(loc); await settle();
      const got = tabs().map((x) => x.textContent.trim());
      ok(`the tab names in ${loc}`, got.join('|') === NAMES[loc].join('|'), got.join('|'));
      ok(`${loc}: every tab's name is translated`, KEYS.every((k) => t(['Map and reports', 'Screen lock', 'Topo server', 'Monitoring', 'Back-ups', 'Setup'][KEYS.indexOf(k)]) !== ['Map and reports', 'Screen lock', 'Topo server', 'Monitoring', 'Back-ups', 'Setup'][KEYS.indexOf(k)]));
    }
    ok('ja says PC, never パソコン', !tabs().some((x) => /パソコン/.test(x.textContent)));
    setLocale('en'); applyLocale('en'); await settle();

    // ---- Phone and desktop, both themes ----
    const audits = async (w, h, theme) => {
      await __viewport(w, h); await wait(250);
      const tag = `${theme} @${w}`;
      if (window.CarinoTheme) CarinoTheme.apply(theme);
      await settle();
      ok(`${tag}: the theme is applied`, !!window.CarinoTheme && document.documentElement.getAttribute('data-carino-theme') === theme, document.documentElement.getAttribute('data-carino-theme'));
      openSettings('general'); await settle();
      const horiz = bar.getAttribute('aria-orientation') === 'horizontal';
      ok(`${tag}: the tabs ${w <= 640 ? 'a row across the top' : 'down the side'}`, w <= 640
        ? horiz && bar.getBoundingClientRect().bottom <= box.getBoundingClientRect().top + 1
        : !horiz && bar.getBoundingClientRect().right <= box.getBoundingClientRect().left + 1, bar.getAttribute('aria-orientation'));
      if (w <= 640) {
        ok(`${tag}: each tab 44px tall`, tabs().filter((x) => !x.hidden).every((x) => x.getBoundingClientRect().height >= 44), tabs().map((x) => x.getBoundingClientRect().height).join());
        ok(`${tag}: the row scrolls inside itself, never the page`, getComputedStyle(bar).overflowX === 'auto' && document.documentElement.scrollWidth <= innerWidth);
      }
      for (const k of live()) {
        tab(k).click(); await settle();
        ok(`${tag}: ${k} — the tab shown is inside the row`, (() => { const a = tab(k).getBoundingClientRect(), c = bar.getBoundingClientRect(); return a.left >= c.left - 1 && a.right <= c.right + 1; })());
        const res = window.touchAudit(`Settings, ${k}`);
        const lines = res.lines.filter((l) => !/^screen not reached/.test(l));
        if (w <= 640) ok(`${tag}: ${k} — 44px targets, 16px fields, nothing past the edge`, !lines.length && res.measured > 0, lines.slice(0, 5).join(' | '));
        ok(`${tag}: ${k} — no sideways page scroll`, document.documentElement.scrollWidth <= innerWidth, `${document.documentElement.scrollWidth} > ${innerWidth}`);
      }
      closeSettings(); await settle();
    };
    for (const theme of ['gold', 'color']) {
      await audits(360, 780, theme);
      await audits(390, 844, theme);
      await audits(1280, 800, theme);
    }
    if (window.CarinoTheme) CarinoTheme.apply('gold');
    await __viewport(360, 780); await settle();

    // Opening at a tab at the end of the row (kept, or asked for) brings it
    // into the row once the dialog shows (D362), in the longer Russian words.
    setLocale('ru'); applyLocale('ru'); await settle();
    const lastLive = live()[live().length - 1];
    const inRow = (k) => { const a = tab(k).getBoundingClientRect(), c = bar.getBoundingClientRect(); return a.width > 0 && a.left >= c.left - 1 && a.right <= c.right + 1; };
    openSettings('general'); await settle(); closeSettings(); await settle();
    sessionStorage.setItem(KEPT, lastLive);
    openSettings(); await settle();
    ok(`360, ru: the row scrolls (${lastLive} past its edge otherwise)`, bar.scrollWidth > bar.clientWidth, `${bar.scrollWidth} / ${bar.clientWidth}`);
    ok(`360, ru: Settings opened at the kept ${lastLive}: the tab is inside the row`, shownTab() === lastLive && inRow(lastLive), `${shownTab()} ${bar.scrollLeft}`);
    closeSettings(); await settle();
    openSettings('general'); await settle(); closeSettings(); await settle();
    openSettings(lastLive); await settle();
    ok(`360, ru: openSettings(${lastLive}): the tab is inside the row`, shownTab() === lastLive && inRow(lastLive), String(bar.scrollLeft));
    closeSettings(); await settle();
    setLocale('en'); applyLocale('en'); await settle();

    ok('no console error', !errors.length, errors.slice(0, 4).join(' | '));
  } catch (e) {
    ok('the suite ran to the end', false, (e && e.stack) || String(e));
  } finally {
    TopoWelcome.state.invoke = null;
    try { sessionStorage.removeItem(KEPT); localStorage.removeItem('topo-lock-note'); } catch (e) { /* none */ }
    const pre = document.createElement('pre'); pre.id = 'TESTOUT'; pre.textContent = out.join('\n');
    document.body.appendChild(pre);
  }
}, 300); });
