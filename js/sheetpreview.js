// ---- The sheets' print preview: labels and Locate ----
// Print labels (printAssetLabels, js/assets.js) and Print where they are
// plugged in (printLocate, js/locate.js) used to open the sheet in a new tab
// with a Print button of its own, or download it when the pop-up was
// blocked. Like the site report (refreshReportPreview, js/report.js), each now
// shows first, in a dialog, exactly the page that is printed or saved: Print
// prints that frame, Download saves it in the format the PDF | HTML switch
// says (reportFormat, js/report.js): HTML is the same bytes under the same
// name as before, PDF the same pages drawn into a PDF (carino-pdf.js) on the
// sheet's own paper (its @page: a 62 x 29 mm page per label, A4 with the
// Locate sheet's margins). The ✕ (or Esc, or the backdrop) drops it and
// nothing is handed over. The dialog is the fleet's report preview
// (carino-ui.css 18b .rpv): title, count, the sheet's note, the switch and
// the file name in the left column, Print then Download at its foot, the
// page on the right (the stage).
//
// The frame holds the sheet itself. Its own print rules are made to apply on
// screen too (@media print read as @media all: under print that is the same
// thing, so what the frame prints is unchanged), and a screen-only style
// lays it out as paper: each label a 62 x 29 mm page of its own; the Locate
// sheet a page wide with its @page margins, with a dashed line where each
// page ends (worked out for A4, which the status says: the paper is the
// printer's). On a screen narrower than a page the frame is laid out a page
// wide and scaled, as the report's preview is (fitReportPreview); labels,
// far smaller than a screen, are shown up to twice their size.
//
// Opened as a file (the offline zip) a blob: frame is another origin, so
// there the sheet goes in as srcdoc, as the report's preview does.

const SP_MM = 96 / 25.4;
const SHEET_PREVIEW = {
    // One label per page, at its size (labelsHtml's @page).
    labels: { pageW: 62 * SP_MM, zoomMax: 2, gutter: 32,
        css: `html { background: #d6d8dc; }
body { background: transparent !important; }
.toolbar { display: none !important; }
.sheet { display: flex !important; flex-direction: column; align-items: center; gap: 14px; padding: 16px !important; }
.lbl { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3); }` },
    // A4 with the sheet's @page margins (locateHtml): 16 mm top and bottom,
    // 14 mm at the sides.
    locate: { pageW: 210 * SP_MM, pageH: 297 * SP_MM, marginY: 16 * SP_MM, marginX: 14 * SP_MM, zoomMax: 1, gutter: 32 }
};
SHEET_PREVIEW.locate.css = (() => {
    const s = SHEET_PREVIEW.locate, px = (v) => `${Math.round(v * 10) / 10}px`;
    return `html { background: #d6d8dc; }
body { box-sizing: content-box; width: ${px(s.pageW - 2 * s.marginX)}; min-height: ${px(s.pageH - 2 * s.marginY)}; padding: ${px(s.marginY)} ${px(s.marginX)};
  margin: 16px auto 24px !important; position: relative; background: #fff !important; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.28); }
.toolbar { display: none !important; }
.sp-break { position: absolute; left: 0; right: 0; height: 0; border-top: 1.5px dashed #9aa0a8; pointer-events: none; }
.sp-break span { position: absolute; left: 8px; top: 3px; font: 10px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; color: #6b7280; }`;
})();

const _sheetPv = { seq: 0, cfg: null, built: null, url: null, back: null, ready: null, status: '' };
const sheetPvEl = (id) => document.getElementById(id);
const sheetPreviewOpen = () => { const d = sheetPvEl('sheetPreviewDialog'); return !!d && !d.classList.contains('hidden'); };

// The sheet as the frame shows it: its own print rules on screen as well,
// then the paper. Never what is printed from outside the frame or saved.
function sheetPreviewHtml(html, kind) {
    const spec = SHEET_PREVIEW[kind];
    if (!spec) return html;
    // The page-end marks (measureSheetPreview) are the preview's own: printing
    // the frame must not put them on paper.
    return html.replace(/@media print\b/g, '@media all').replace('</head>',
        `<style>@media screen {\n${spec.css}\n}</style><style>@media print { .sp-break { display: none !important; } }</style></head>`);
}

// Where the Locate sheet's pages end, in px from the top of the page's
// printed area: a device's block is never split (break-inside: avoid), so a
// block that would cross the end starts the next page, unless it is taller
// than a page itself.
function sheetPageBreaks(doc, top, pageH) {
    const breaks = [];
    let start = 0;
    doc.querySelectorAll('.dev-block').forEach((b) => {
        const r = b.getBoundingClientRect();
        const y0 = r.top - top, y1 = r.bottom - top;
        while (y1 - start > pageH) {
            start = (y0 > start && y1 - y0 <= pageH) ? y0 : start + pageH;
            breaks.push(start);
        }
    });
    return breaks;
}

function sheetPreviewStatus(text) { const el = sheetPvEl('sheetPreviewStatus'); if (el) el.textContent = text || ''; }

// The Download button and the file name follow the PDF | HTML switch.
function syncSheetFormat() {
    const dl = sheetPvEl('sheetPreviewDownload');
    if (dl) dl.textContent = reportDownloadLabel();
    const b = _sheetPv.built, name = sheetPvEl('sheetPreviewName');
    if (b && name) name.textContent = reportFileName(b.meta, b.kind, reportFormat());
}

// The page counted and marked once the frame shows it.
function measureSheetPreview(frame, kind) {
    const doc = frame.contentDocument;
    if (!doc || !doc.body) return '';
    if (kind === 'labels') {
        const n = doc.querySelectorAll('.lbl').length;
        return n === 1 ? t('1 label') : t('{n} labels', { n });
    }
    const s = SHEET_PREVIEW.locate;
    const r = doc.body.getBoundingClientRect();
    const breaks = sheetPageBreaks(doc, r.top + s.marginY, s.pageH - 2 * s.marginY);
    breaks.forEach((b, i) => {
        const line = doc.createElement('div');
        line.className = 'sp-break';
        line.style.top = `${s.marginY + b}px`;
        const tag = doc.createElement('span');
        tag.textContent = t('Page {n}', { n: i + 2 });
        line.appendChild(tag);
        doc.body.appendChild(line);
    });
    const pages = breaks.length + 1;
    return pages === 1 ? t('1 page (A4)') : t('{n} pages (A4)', { n: pages });
}

// A stage narrower than a page shows the page scaled down, as it prints;
// labels in a wide stage are shown larger. Only the frame element is scaled,
// so printing its document is untouched.
function fitSheetPreview() {
    const frame = sheetPvEl('sheetPreviewFrame'), stage = sheetPvEl('sheetPreviewStage');
    const spec = _sheetPv.cfg && SHEET_PREVIEW[_sheetPv.cfg.kind];
    if (!frame || !stage || !spec) return;
    Object.assign(frame.style, { width: '', height: '', transform: '', transformOrigin: '' });
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    const k = Math.min(w / (spec.pageW + spec.gutter), spec.zoomMax);
    if (Math.abs(k - 1) < 0.01) return;
    Object.assign(frame.style, { width: `${w / k}px`, height: `${h / k}px`, transform: `scale(${k})`, transformOrigin: '0 0' });
}

// Builds the sheet (cfg.build, again after a language switch) and shows it.
// -> a promise, resolved once the frame shows it.
function refreshSheetPreview() {
    const cfg = _sheetPv.cfg, frame = sheetPvEl('sheetPreviewFrame');
    if (!cfg || !frame) return Promise.resolve(null);
    const seq = ++_sheetPv.seq;
    const html = cfg.build();
    const built = { html, meta: cfg.meta, kind: cfg.kind, name: reportFileName(cfg.meta, cfg.kind) };
    _sheetPv.built = built;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    sheetPvEl('sheetPreviewTitle').textContent = doc.title || '';
    const note = doc.querySelector('.toolbar span');
    sheetPvEl('sheetPreviewBlurb').textContent = note ? note.textContent : '';
    const opts = sheetPvEl('sheetPreviewOpts');
    if (opts) opts.hidden = !note;
    sheetPvEl('sheetPreviewName').textContent = reportFileName(cfg.meta, cfg.kind, reportFormat());
    const dl = sheetPvEl('sheetPreviewDownload');
    if (dl) dl.textContent = reportDownloadLabel();
    _sheetPv.status = '';
    sheetPreviewStatus('');
    ['sheetPreviewPrint', 'sheetPreviewDownload'].forEach((id) => { const b = sheetPvEl(id); if (b) b.disabled = true; });
    const shownHtml = sheetPreviewHtml(html, cfg.kind);
    const inline = location.protocol === 'file:';
    const url = inline ? null : URL.createObjectURL(new Blob([shownHtml], { type: 'text/html;charset=utf-8' }));
    const old = _sheetPv.url;
    _sheetPv.url = url;
    const ready = new Promise((done) => {
        const shown = () => {
            frame.onload = null;
            if (old) URL.revokeObjectURL(old);
            if (seq !== _sheetPv.seq) { done(null); return; }
            fitSheetPreview();
            // Esc with the focus in the frame (a click on the sheet) closes too.
            try { frame.contentWindow.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheetPreview(); }); } catch (e) { /* not readable */ }
            let status = '';
            try { status = measureSheetPreview(frame, cfg.kind); } catch (e) { console.warn('Print preview: could not measure the pages.', e); }
            _sheetPv.status = status;
            sheetPreviewStatus(status);
            ['sheetPreviewPrint', 'sheetPreviewDownload'].forEach((id) => { const b = sheetPvEl(id); if (b) b.disabled = false; });
            done(built);
        };
        frame.onload = shown;
        setTimeout(() => { if (frame.onload === shown) shown(); else done(null); }, 5000);   // a frame that never says it loaded
        if (inline) { frame.removeAttribute('src'); frame.srcdoc = shownHtml; }
        else { frame.removeAttribute('srcdoc'); frame.src = url; }
    });
    _sheetPv.ready = ready;
    return ready;
}

// cfg: { kind: 'labels' | 'locate', meta: { site, date }, build() -> html }.
// -> { html, name, kind, previewed, ready }; nothing is printed or saved yet.
function openSheetPreview(cfg) {
    const dialog = sheetPvEl('sheetPreviewDialog');
    if (!dialog) {   // a page without the dialog: the tab, as before
        const html = cfg.build();
        return Object.assign({ html, kind: cfg.kind, previewed: false }, openReportTab(html, cfg.meta, cfg.kind));
    }
    if (!sheetPreviewOpen()) _sheetPv.back = document.activeElement;
    _sheetPv.cfg = cfg;
    // The PDF | HTML switch above the file name (reportFormat, js/report.js).
    mountReportFormat(dialog, syncSheetFormat);
    dialog.classList.remove('hidden');
    const ready = refreshSheetPreview();
    const close = sheetPvEl('sheetPreviewClose');
    if (close) close.focus();
    const b = _sheetPv.built;
    return { html: b.html, name: b.name, kind: b.kind, previewed: true, ready };
}

function closeSheetPreview() {
    const dialog = sheetPvEl('sheetPreviewDialog');
    if (!dialog || dialog.classList.contains('hidden')) return;
    _sheetPv.seq++;
    dialog.classList.add('hidden');
    const frame = sheetPvEl('sheetPreviewFrame');
    if (frame) { frame.onload = null; frame.removeAttribute('src'); frame.removeAttribute('srcdoc'); Object.assign(frame.style, { width: '', height: '', transform: '' }); }
    if (_sheetPv.url) URL.revokeObjectURL(_sheetPv.url);
    _sheetPv.url = null; _sheetPv.cfg = null; _sheetPv.built = null; _sheetPv.ready = null;
    const back = _sheetPv.back;
    _sheetPv.back = null;
    try { if (back && back.isConnected && typeof back.focus === 'function') back.focus(); } catch (e) { /* gone */ }
}

// Print: the frame printed as it shows (or saved as PDF from the print
// dialog). The desktop app on macOS cannot print a frame (WKWebView), so an
// app that prints reports itself (hostPrintsReports, js/report.js) is handed
// the sheet, as the report's Print does. The dialog stays, for a copy.
async function printSheetPreview() {
    const b = _sheetPv.built, frame = sheetPvEl('sheetPreviewFrame');
    if (!b || !frame) return false;
    if (_sheetPv.ready) await _sheetPv.ready;
    if (b !== _sheetPv.built || !frame.contentWindow) return false;
    const host = window.__TAURI__ && window.__TAURI__.core;
    if (host && typeof host.invoke === 'function' && await hostPrintsReports(host)) {
        try {
            if (await host.invoke('host_print', { html: b.html, name: b.name })) return true;
        } catch (e) { console.warn('Print preview: the app could not print, printing the preview.', e); }
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
    return true;
}

// Download, in the switch's format (reportFormat). HTML: the sheet as a
// file, the same bytes and name the blocked-pop-up fallback saved before;
// the dialog closes. -> { name, url, format }. PDF: the same pages drawn on
// the sheet's paper (makeReportPdf, js/report.js), the buttons held and the
// status saying so meanwhile, then saved under the same stem and the dialog
// closed; one that could not be made says so and the dialog stays, one
// finished after the dialog was closed is not saved.
// -> a promise of { ok, name, url?, format, error? }.
function downloadSheetPreview() {
    const b = _sheetPv.built;
    if (!b) return null;
    if (reportFormat() !== 'pdf') {
        const url = saveBlob(new Blob([b.html], { type: 'text/html;charset=utf-8' }), b.name);
        closeSheetPreview();
        return { name: b.name, url, format: 'html' };
    }
    const name = reportFileName(b.meta, b.kind, 'pdf');
    const btns = ['sheetPreviewPrint', 'sheetPreviewDownload'].map(sheetPvEl).filter(Boolean);
    btns.forEach((x) => { x.disabled = true; });
    sheetPreviewStatus(t('Creating the PDF…'));
    const still = () => _sheetPv.built === b && sheetPreviewOpen();
    return makeReportPdf(b.html).then((blob) => {
        if (!still()) return { ok: false, cancelled: true, name, format: 'pdf' };
        const url = saveBlob(blob, name);
        closeSheetPreview();
        return { ok: true, name, url, format: 'pdf' };
    }, (e) => {
        console.warn('Print preview: could not create the PDF.', e);
        if (still()) sheetPreviewStatus(t('Could not create the PDF.'));
        return { ok: false, name, format: 'pdf', error: (e && e.message) || String(e) };
    }).then((out) => {
        if (still()) btns.forEach((x) => { x.disabled = false; });
        return out;
    });
}

(function wireSheetPreview() {
    const dialog = sheetPvEl('sheetPreviewDialog');
    if (!dialog) return;
    dialog.addEventListener('click', (e) => { if (e.target === dialog) closeSheetPreview(); });   // the backdrop
    sheetPvEl('sheetPreviewClose').onclick = () => closeSheetPreview();
    sheetPvEl('sheetPreviewDownload').onclick = () => downloadSheetPreview();
    sheetPvEl('sheetPreviewPrint').onclick = async () => {
        const btn = sheetPvEl('sheetPreviewPrint');
        btn.disabled = true;
        try { await printSheetPreview(); }
        catch (err) { console.warn('Could not print the sheet:', err); showToast(t('Could not build the report.'), 'err'); }
        finally { if (sheetPreviewOpen()) btn.disabled = false; }
    };
    window.addEventListener('resize', () => { if (sheetPreviewOpen()) fitSheetPreview(); });
    // A language switch while it is open: the sheet in the new language
    // (i18n.js's listener, registered first, has switched the dictionary).
    window.addEventListener('carino:langchange', () => setTimeout(() => { if (sheetPreviewOpen()) { relabelReportFormats(); refreshSheetPreview(); } }, 0));
})();
// What the open preview holds ({ html, meta, kind, name }), or null.
const sheetPreviewBuilt = () => _sheetPv.built;
