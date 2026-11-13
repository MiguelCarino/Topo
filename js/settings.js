// ---- Settings (the ⚙ Settings button in the bar) ----
// This browser's preferences, never the document's: they are kept with the
// rest of state.settings (saveSettings, js/app.js), so a network sent to
// someone else opens with their settings, not these. Five sections:
//
//   Language the fleet-wide language (carino-lang.js owns the preference and
//            keeps it across *.carino.systems; Topo hides its navbar button,
//            so this is where it is picked). Auto follows the browser.
//   Map      the opt-ins and opt-outs of what the map shows: the provider on
//            hover (off until ticked: a tooltip on every device is noise to
//            anyone who has not asked for it), the background (as the ◐
//            button cycles it) and the subnet zones (as the Subnets tab's
//            toggle).
//   Reports  the defaults the report dialog opens with: who prepares it
//            (filled in when the network's own header names nobody) and
//            which parts are ticked.
//   History  whether back-ups and reports record the address history
//            (js/trail.js; on unless turned off). Off stops recording and
//            keeps what is recorded: Clear history on the card removes it.
//            And whether the Simple views' device panel shows a short
//            read-only history (off unless ticked). In every view (the
//            owner, 2026-11-05).
//   Screen lock  the idle lock (js/idlelock.js): the time, the PIN, Lock
//            now. Kept in its own keys, not in state.settings.
//   Problem reports  the name, phone and email Report a problem fills in
//            (js/incidents.js): kept here only, carried by a report sent.
//   Setup    Run the setup again (js/welcome.js wires the button; D356):
//            the desktop app only (D425).
//   About    what Topo is, what it keeps and sends (the same words as the
//            navbar's About), the document version, and the licence,
//            contact and legal page behind the navbar's About.
//
// The sections sit in six tabs (D361), as the navbar's About window: Map and
// reports (Map, Reports, History, Problem reports), Screen lock, Topo server
// (Connect to a Topo server, This PC as the server), Monitoring (Monitor
// from this PC, the site's monitor, alarms, statistics), Back-ups and Setup
// (Run the setup again, This computer). A tab whose sections are all hidden
// (the app's own on the website, Back-ups outside Chrome and Edge) is
// hidden. openSettings(where) opens at a tab or at a control's tab;
// revealInSettings(el) shows an element's tab and scrolls to it.
//
// Each change applies at once and is kept at once; there is no Save.
// Load order: ... -> app -> settings

const setEl = (id) => document.getElementById(id);
const SETTINGS_ENGINEER_MAX = 120;

// The defaults a missing setting reads as.
const providerHoverOn = () => state.settings.providerHover === true;
const reportEngineerDefault = () => (typeof state.settings.reportEngineer === 'string' ? state.settings.reportEngineer : '');
const reportPartDefault = (key) => state.settings[key] !== false;   // reportSummaryOn, reportTechnicalOn

function renderSettings() {
    const hover = setEl('setProviderHover');
    if (hover) hover.checked = providerHoverOn();
    const ink = setEl('setMapInk');
    if (ink) ink.value = state.settings.mapInk || '';
    const zones = setEl('setSubnetZones');
    if (zones) zones.checked = state.settings.subnetZones !== false;
    const who = setEl('setEngineer');
    if (who && document.activeElement !== who) who.value = reportEngineerDefault();
    const sum = setEl('setReportSummary'), tech = setEl('setReportTechnical');
    if (sum) sum.checked = reportPartDefault('reportSummaryOn');
    if (tech) tech.checked = reportPartDefault('reportTechnicalOn');
    const trail = setEl('setTrailRecording');
    if (trail) trail.checked = state.settings.trailRecording !== false;
    const simple = setEl('setTrailSimple');
    if (simple) simple.checked = state.settings.trailSimple === true;
    const rep = state.settings.reporter || {};
    [['setReporterName', 'name'], ['setReporterPhone', 'phone'], ['setReporterEmail', 'email']].forEach(([id, k]) => {
        const f = setEl(id);
        if (f && document.activeElement !== f) f.value = rep[k] || '';
    });
    fillDocVersion();
    // Screen lock: this PC's idle lock and PIN (js/idlelock.js).
    if (typeof renderIdleLockSettings === 'function') renderIdleLockSettings();
    // Back-ups: the folder (js/backupdir.js).
    if (typeof renderBackupDirSettings === 'function') renderBackupDirSettings();
    // Connect to a Topo server: the desktop app only (js/desktopclient.js).
    if (typeof renderDesktopClientSettings === 'function') renderDesktopClientSettings();
    // This PC as the server: the desktop app only (js/desktopserver.js).
    if (typeof renderDesktopServerSettings === 'function') renderDesktopServerSettings();
    // Setup, Run the setup again: the desktop app only (js/welcome.js, D425).
    if (typeof renderWelcomeSettings === 'function') renderWelcomeSettings();
    // This computer: the desktop app only (js/thiscomputer.js).
    if (typeof renderThisComputer === 'function') renderThisComputer();
    // Monitor from this PC: the desktop app only (js/checks.js).
    if (typeof renderMonitorSettings === 'function') renderMonitorSettings();
}
// The document format version, in the navbar's About window (index.html's
// data-carino-about block): filled at start and again with each language.
function fillDocVersion() {
    const ver = setEl('setVersion');
    if (ver) ver.textContent = t('Document version {v}', { v: DOC_VERSION });
}

// ---- The section tabs (D361) ----
// One panel at a time. The tab shown is kept for this browser tab
// (sessionStorage), so Settings opens again where it was left; a deep link
// (openSettings('setMonSec'), revealInSettings) opens at its control's tab.
// _setTabs.want is the tab asked for in this opening: while its sections are
// still hidden (the app answers a moment later) the first tab with something
// to show stands in, and the wanted one comes back as soon as it shows.
const SETTINGS_TAB_KEY = 'topo.settings.tab';
const _setTabs = { want: '', current: 'general' };
const settingsTabButtons = () => Array.from(document.querySelectorAll('#settingsDialog .set-tab'));
const settingsPanelOf = (tab) => setEl(tab.getAttribute('aria-controls'));
const settingsPanels = () => document.querySelector('#settingsDialog .set-panels');
// A tab shows when one of its sections does.
function settingsTabLive(tab) {
    const panel = settingsPanelOf(tab);
    return !!panel && Array.from(panel.children).some((sec) => !sec.hidden);
}
function readSettingsTab() {
    try { return sessionStorage.getItem(SETTINGS_TAB_KEY) || ''; } catch (e) { return ''; }
}
function keepSettingsTab(key) {
    try { sessionStorage.setItem(SETTINGS_TAB_KEY, key); } catch (e) { /* not kept: Settings opens at the first tab */ }
}
function showSettingsTab(key, opts) {
    const o = opts || {};
    const tabs = settingsTabButtons();
    const tab = tabs.find((x) => x.dataset.tab === key);
    if (!tab) return false;
    const changed = _setTabs.current !== key;
    _setTabs.current = key;
    tabs.forEach((x) => {
        const on = x === tab;
        x.setAttribute('aria-selected', on ? 'true' : 'false');
        x.tabIndex = on ? 0 : -1;
        const panel = settingsPanelOf(x);
        if (panel) panel.hidden = !on;
    });
    if (changed) { const box = settingsPanels(); if (box) box.scrollTop = 0; }
    if (o.focus) tab.focus({ preventScroll: true });
    settingsTabIntoRow(tab);
    if (o.keep !== false) keepSettingsTab(key);
    return true;
}
// The phone's row scrolls sideways: the tab shown is brought into it. While
// the dialog is hidden the row has no size (and its scroll is lost), so
// openSettings runs this again once the dialog shows.
function settingsTabIntoRow(tab) {
    const bar = tab && tab.parentElement;
    if (!bar || bar.scrollWidth <= bar.clientWidth) return;
    const b = bar.getBoundingClientRect(), r = tab.getBoundingClientRect();
    if (r.left < b.left) bar.scrollLeft -= b.left - r.left + 8;
    else if (r.right > b.right) bar.scrollLeft += r.right - b.right + 8;
}
// Tabs follow their sections: hidden with them, and the panel shown is one
// with something in it.
function syncSettingsTabs() {
    const tabs = settingsTabButtons();
    if (!tabs.length) return;
    tabs.forEach((x) => { x.hidden = !settingsTabLive(x); });
    const live = tabs.filter((x) => !x.hidden);
    if (_setTabs.want && _setTabs.current !== _setTabs.want && live.some((x) => x.dataset.tab === _setTabs.want)) {
        showSettingsTab(_setTabs.want, { keep: false });
        return;
    }
    if (!live.some((x) => x.dataset.tab === _setTabs.current) && live.length) showSettingsTab(live[0].dataset.tab, { keep: false });
}
// A tab's key, or the tab a Settings element (or its id) sits in; '' for
// anything else.
function settingsTabFor(where) {
    if (!where) return '';
    if (typeof where === 'string' && settingsTabButtons().some((x) => x.dataset.tab === where)) return where;
    const node = typeof where === 'string' ? setEl(where) : where;
    const panel = node && node.closest ? node.closest('#settingsDialog .set-panel') : null;
    return panel ? panel.id.replace(/^setPanel-/, '') : '';
}
// Show a Settings element: its tab, scrolled to it inside the panel (never
// a scrollIntoView, which would also scroll the dialog's clipped frame), and
// a control focused. -> false when it is not on screen (its section hidden).
function revealInSettings(where, opts) {
    const o = opts || {};
    const node = typeof where === 'string' ? setEl(where) : where;
    const key = settingsTabFor(node);
    if (!key) return false;
    _setTabs.want = key;
    showSettingsTab(key);
    syncSettingsTabs();
    if (!node.getClientRects().length) return false;
    const box = settingsPanels();
    if (box) {
        const top = node.getBoundingClientRect().top - box.getBoundingClientRect().top;
        box.scrollTop = Math.max(0, box.scrollTop + top - (o.block === 'nearest' ? 0 : 8));
    }
    if (o.focus !== false && node.matches('input, select, textarea, button')) node.focus({ preventScroll: true });
    return true;
}
function onSettingsTabKey(e) {
    const tab = e.target.closest('.set-tab');
    if (!tab) return;
    const live = settingsTabButtons().filter((x) => !x.hidden);
    const i = live.indexOf(tab);
    let next = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = live[(i + 1) % live.length];
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = live[(i - 1 + live.length) % live.length];
    else if (e.key === 'Home') next = live[0];
    else if (e.key === 'End') next = live[live.length - 1];
    if (!next) return;
    e.preventDefault();
    _setTabs.want = next.dataset.tab;
    showSettingsTab(next.dataset.tab, { focus: true });
}
function wireSettingsTabs() {
    const bar = document.querySelector('#settingsDialog .set-tabs');
    if (!bar) return;
    bar.addEventListener('click', (e) => {
        const tab = e.target.closest('.set-tab');
        if (!tab) return;
        _setTabs.want = tab.dataset.tab;
        showSettingsTab(tab.dataset.tab, { focus: true });
    });
    bar.addEventListener('keydown', onSettingsTabKey);
    // Down the side, or a row across the top on a phone (css/app.css).
    const mq = window.matchMedia ? window.matchMedia('(max-width: 640px)') : null;
    const orient = () => bar.setAttribute('aria-orientation', mq && mq.matches ? 'horizontal' : 'vertical');
    orient();
    if (mq && mq.addEventListener) mq.addEventListener('change', orient);
    // A section shown or hidden later (the app's answer, the folder API)
    // shows or hides its tab.
    const box = settingsPanels();
    if (box && window.MutationObserver) {
        new MutationObserver((list) => {
            if (list.some((m) => m.target.parentElement && m.target.parentElement.classList.contains('set-panel'))) syncSettingsTabs();
        }).observe(box, { attributes: true, attributeFilter: ['hidden'], subtree: true });
    }
    syncSettingsTabs();
}

// openSettings(where): where is a tab ('general', 'lock', 'server',
// 'monitor', 'backup', 'setup'), or a Settings element or its id, which is
// then scrolled to and, a control, focused. Nothing: the tab kept for this
// browser tab, else the first; a Screen lock note not yet read (D219) or a
// server certificate waiting for a decision wins over the kept tab, so it
// is seen.
function openSettings(where) {
    const scrim = setEl('settingsDialog');
    if (!scrim) return;
    if (where && typeof where !== 'string' && !(where instanceof Element)) where = '';   // a click's event
    renderSettings();
    const isTab = typeof where === 'string' && settingsTabButtons().some((x) => x.dataset.tab === where);
    let key = settingsTabFor(where);
    const note = setEl('setLockNoteRow');
    if (!key && note && !note.hidden) key = 'lock';
    // A server certificate waiting for a decision wins too (D362): refused
    // (Check again, the toast that announces it sends the person here) or
    // shown to compare.
    const dc = setEl('setDcSec'), cmp = setEl('setDcCompare'), again = setEl('setDcAgain');
    if (!key && dc && !dc.hidden && ((cmp && !cmp.hidden) || (again && !again.hidden))) key = 'server';
    if (!key) key = readSettingsTab() || 'general';
    _setTabs.want = key;
    showSettingsTab(key, { keep: !!where });
    syncSettingsTabs();
    if (window.CarinoUI) CarinoUI.modal.open(scrim);
    else scrim.hidden = false;
    if (where && !isTab) revealInSettings(where);
    else settingsTabIntoRow(settingsTabButtons().find((x) => x.dataset.tab === _setTabs.current));
}
function closeSettings() {
    const scrim = setEl('settingsDialog');
    if (!scrim) return;
    if (window.CarinoUI && CarinoUI.modal.isOpen(scrim)) CarinoUI.modal.close(scrim, 'answered');
    else scrim.hidden = true;
}
const settingsOpen = () => { const s = setEl('settingsDialog'); return !!s && !s.hidden; };

function onSettingsChange(e) {
    const el = e.target;
    if (el.id === 'setProviderHover') { state.settings.providerHover = el.checked; saveSettings(); renderCanvasOnly(); }
    else if (el.id === 'setMapInk') { setMapInk(el.value); saveSettings(); }
    else if (el.id === 'setSubnetZones') { state.settings.subnetZones = el.checked; saveSettings(); renderCanvasOnly(); renderNetworksPanel(true); }
    else if (el.id === 'setTrailRecording') {
        // Off is kept as false; on is the default, so the key goes.
        if (el.checked) delete state.settings.trailRecording; else state.settings.trailRecording = false;
        saveSettings();
        trailSettingChanged();
    }
    else if (el.id === 'setTrailSimple') {
        // On is kept as true; off is the default, so the key goes.
        if (el.checked) state.settings.trailSimple = true; else delete state.settings.trailSimple;
        saveSettings();
        trailSettingChanged();
    }
    else if (el.id === 'setReportSummary' || el.id === 'setReportTechnical') {
        const sum = setEl('setReportSummary'), tech = setEl('setReportTechnical');
        // One part at least, as in the report dialog.
        if (!sum.checked && !tech.checked) (el === sum ? tech : sum).checked = true;
        state.settings.reportSummaryOn = sum.checked;
        state.settings.reportTechnicalOn = tech.checked;
        saveSettings();
    }
}
// The History section's note and empty line follow the switch.
function trailSettingChanged() {
    if (typeof refreshHistoryPanelSafe === 'function') refreshHistoryPanelSafe();
}
// Another tab of this browser turned address history off or on: this tab
// follows, so it neither records against the switch nor writes the old value
// back over it with its next settings save. Only the two history switches
// are taken over; the other settings stay this tab's until it reloads.
function onSettingsStorage(e) {
    if (!e || (e.key !== SETTINGS_KEY && e.key !== null)) return;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (err) { saved = {}; }
    const was = [state.settings.trailRecording !== false, state.settings.trailSimple === true];
    if (saved.trailRecording === false) state.settings.trailRecording = false; else delete state.settings.trailRecording;
    if (saved.trailSimple === true) state.settings.trailSimple = true; else delete state.settings.trailSimple;
    if (was[0] === (state.settings.trailRecording !== false) && was[1] === (state.settings.trailSimple === true)) return;
    const box = setEl('setTrailRecording');
    if (box) box.checked = state.settings.trailRecording !== false;
    const simple = setEl('setTrailSimple');
    if (simple) simple.checked = state.settings.trailSimple === true;
    trailSettingChanged();
}
window.addEventListener('storage', onSettingsStorage);

const SETTINGS_REPORTER_FIELDS = { setReporterName: 'name', setReporterPhone: 'phone', setReporterEmail: 'email' };
function onSettingsInput(e) {
    if (SETTINGS_REPORTER_FIELDS[e.target.id]) {
        // Problem reports (js/incidents.js): who reports from this browser.
        const next = Object.assign({}, state.settings.reporter || {}, { [SETTINGS_REPORTER_FIELDS[e.target.id]]: e.target.value });
        const rep = normalizeReporterSetting(next);
        if (rep) state.settings.reporter = rep; else delete state.settings.reporter;
        saveSettings();
        return;
    }
    if (e.target.id !== 'setEngineer') return;
    state.settings.reportEngineer = String(e.target.value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, SETTINGS_ENGINEER_MAX);
    saveSettings();
}

(function wireSettings() {
    fillDocVersion();
    const btn = setEl('settingsBtn');
    if (btn) btn.addEventListener('click', () => openSettings());
    const scrim = setEl('settingsDialog');
    if (!scrim) return;
    scrim.addEventListener('change', onSettingsChange);
    scrim.addEventListener('input', onSettingsInput);
    const done = setEl('settingsDoneBtn');
    if (done) done.addEventListener('click', closeSettings);
    wireSettingsTabs();
    if (!window.CarinoUI) {
        scrim.addEventListener('click', (e) => { if (e.target === scrim || e.target.closest('[data-close]')) closeSettings(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && settingsOpen()) closeSettings(); });
    }
})();
