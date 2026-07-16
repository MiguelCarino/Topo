// Shared mutable state. Loaded first so nothing can touch it in the TDZ.
// Load order: state -> model -> data -> diagnostics -> ui -> app

const state = {
    nodes: [], links: [], selectedId: null, selectedType: null, linkSourceId: null,
    settings: { traceMode: false },
    camera: { x: 0, y: 0, zoom: 1 }
};
