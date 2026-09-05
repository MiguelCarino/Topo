// Shared mutable state. Loaded first so nothing can touch it in the TDZ.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const state = {
    // report: the survey header (site, client, who signed it). Null until the
    // report dialog is used, and serialized only when non-empty — see
    // serializeReportMeta() in js/report.js.
    // libraryId: which saved network the canvas came from, so Save updates that
    // card instead of breeding a copy. Browser-local bookkeeping, deliberately
    // outside serializeDoc() — it must not ride a shared link, where it would
    // point at an entry in a store the recipient does not have.
    nodes: [], links: [], annotations: [], report: null, libraryId: null, selectedId: null, selectedType: null, linkSourceId: null,
    settings: { traceMode: false, profile: 'simple', advanced: true },
    camera: { x: 0, y: 0, zoom: 1 }
};
