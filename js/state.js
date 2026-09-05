// Shared mutable state. Loaded first so nothing can touch it in the TDZ.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const state = {
    // report: the survey header (site, client, who signed it). Null until the
    // report dialog is used, and serialized only when non-empty — see
    // serializeReportMeta() in js/report.js.
    nodes: [], links: [], annotations: [], report: null, selectedId: null, selectedType: null, linkSourceId: null,
    settings: { traceMode: false, profile: 'simple', advanced: true },
    camera: { x: 0, y: 0, zoom: 1 }
};
