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
//   About    what Topo is, what it keeps and sends (the same words as the
//            navbar's About), the document version, and the licence,
//            contact and legal page behind the navbar's About.
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
    const lang = setEl('setLang');
    if (lang && window.CarinoLang) lang.value = CarinoLang.mode === 'auto' ? 'auto' : CarinoLang.current;
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
    fillDocVersion();
}
// The document format version, in the navbar's About window (index.html's
// data-carino-about block): filled at start and again with each language.
function fillDocVersion() {
    const ver = setEl('setVersion');
    if (ver) ver.textContent = t('Document version {v}', { v: DOC_VERSION });
}

function openSettings() {
    const scrim = setEl('settingsDialog');
    if (!scrim) return;
    renderSettings();
    if (window.CarinoUI) CarinoUI.modal.open(scrim);
    else scrim.hidden = false;
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
    if (el.id === 'setLang') { if (window.CarinoLang) CarinoLang.set(el.value); }
    else if (el.id === 'setProviderHover') { state.settings.providerHover = el.checked; saveSettings(); renderCanvasOnly(); }
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

function onSettingsInput(e) {
    if (e.target.id !== 'setEngineer') return;
    state.settings.reportEngineer = String(e.target.value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, SETTINGS_ENGINEER_MAX);
    saveSettings();
}

(function wireSettings() {
    fillDocVersion();
    const btn = setEl('settingsBtn');
    if (btn) btn.addEventListener('click', openSettings);
    const scrim = setEl('settingsDialog');
    if (!scrim) return;
    scrim.addEventListener('change', onSettingsChange);
    scrim.addEventListener('input', onSettingsInput);
    const done = setEl('settingsDoneBtn');
    if (done) done.addEventListener('click', closeSettings);
    if (!window.CarinoUI) {
        scrim.addEventListener('click', (e) => { if (e.target === scrim || e.target.closest('[data-close]')) closeSettings(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && settingsOpen()) closeSettings(); });
    }
})();
