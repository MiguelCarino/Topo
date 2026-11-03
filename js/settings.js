// ---- Settings (the ⚙ Settings button in the bar) ----
// This browser's preferences, never the document's: they are kept with the
// rest of state.settings (saveSettings, js/app.js), so a network sent to
// someone else opens with their settings, not these. Three sections:
//
//   Map      the opt-ins and opt-outs of what the map shows: the provider on
//            hover (off until ticked: a tooltip on every device is noise to
//            anyone who has not asked for it), the background (as the ◐
//            button cycles it) and the subnet zones (as the Subnets tab's
//            toggle).
//   Reports  the defaults the report dialog opens with: who prepares it
//            (filled in when the network's own header names nobody) and
//            which parts are ticked.
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
    if (el.id === 'setProviderHover') { state.settings.providerHover = el.checked; saveSettings(); renderCanvasOnly(); }
    else if (el.id === 'setMapInk') { setMapInk(el.value); saveSettings(); }
    else if (el.id === 'setSubnetZones') { state.settings.subnetZones = el.checked; saveSettings(); renderCanvasOnly(); renderNetworksPanel(true); }
    else if (el.id === 'setReportSummary' || el.id === 'setReportTechnical') {
        const sum = setEl('setReportSummary'), tech = setEl('setReportTechnical');
        // One part at least, as in the report dialog.
        if (!sum.checked && !tech.checked) (el === sum ? tech : sum).checked = true;
        state.settings.reportSummaryOn = sum.checked;
        state.settings.reportTechnicalOn = tech.checked;
        saveSettings();
    }
}
function onSettingsInput(e) {
    if (e.target.id !== 'setEngineer') return;
    state.settings.reportEngineer = String(e.target.value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').slice(0, SETTINGS_ENGINEER_MAX);
    saveSettings();
}

(function wireSettings() {
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
    // The licence, contact and legal page: the navbar's About popup, which
    // carino-navbar.js builds; this dialog closes first so the two are not
    // stacked.
    const legal = setEl('settingsLegalBtn');
    if (legal) legal.addEventListener('click', () => {
        const nav = document.getElementById('cnLegal');
        closeSettings();
        if (nav) nav.click();
    });
})();
